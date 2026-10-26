import type { Page } from '@playwright/test';
import { readdir } from 'fs/promises';
import path from 'path';
import ExcelJS from 'exceljs';
import type { DbConnection } from '@utils/db.util.ts';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { CoreClaimsHomePage } from '@pages/core-claims-home.page.ts';
import { ClaimsQueryPage } from '@pages/claims-query.page.ts';
import { ALL_PAYMENT_MODES, getChannelDir, isIntakeFilename } from '../scripts/generate-intake-batches.ts';

// Reads every distinct Control Code across whatever intake .xlsx files are
// currently in each channel's test-data/<CHANNEL>/<date>/ folder — relies on
// the folders being cleared between batches (as already done manually today)
// so this reflects only the current run's codes, not stale leftovers from an
// earlier day. Column 14 is "Control Code", same mapping as
// scripts/generate-payment-journal.ts's readPassingRows() — but every row
// counts here, not only passing ones, since a failing row still gets
// intake-processed and should still be checked in Claims Query.
async function readIntakeControlCodes(): Promise<string[]> {
    const codes = new Set<string>();

    for (const mode of ALL_PAYMENT_MODES) {
        const channelDir = getChannelDir(mode);

        let files: string[];
        try {
            files = (await readdir(channelDir)).filter(isIntakeFilename);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw err;
        }

        for (const file of files) {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(path.join(channelDir, file));
            const sheet = workbook.worksheets[0];
            if (!sheet) continue;

            sheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return; // header
                const controlCode = String(row.getCell(14).value ?? '').trim(); // "Control Code"
                if (controlCode) codes.add(controlCode);
            });
        }
    }

    return [...codes];
}

// CONTROL_CODE overrides auto-detection — same override-wins pattern as
// EP_NUMBER_DPS/UB in scripts/generate-return-file.ts — for spot-checking a
// specific or real/historical code by hand. Otherwise, every distinct
// Control Code currently in each channel's intake file(s) is checked.
//
//   PowerShell:  $env:CONTROL_CODE='OPEML2026101900015T'; npx playwright test tests/ClaimsQueryCheck.spec.ts
//   bash:        CONTROL_CODE='OPEML2026101900015T' npx playwright test tests/ClaimsQueryCheck.spec.ts
async function getControlCodes(): Promise<string[]> {
    const raw = process.env.CONTROL_CODE;
    if (raw) {
        return raw.split(',').map((code) => code.trim()).filter(Boolean);
    }

    const codes = await readIntakeControlCodes();
    if (codes.length === 0) {
        throw new Error(
            'No Control Codes found under test-data/. Set CONTROL_CODE to check specific code(s), or generate an intake batch first (node scripts/generate-intake-batches.ts).'
        );
    }
    return codes;
}

// Ground truth is DE's own processed-claims table, not our local intake
// file — a control code can be split into more than one claim line once DE
// actually processes it (confirmed against dbo.de_op_tc_claim_details: 2 rows,
// 2 distinct medicard_bill_code values, for one control_code). Each
// medicard_bill_code is what Claims Query's "Account Ref. No." column shows.
//
// Intake processing takes ~15 min to land in DE, and not every intake row
// ends up with a medicard_bill_code at all — both are normal, not bugs. So
// `total` and `withBillCode` are tracked separately to tell apart three real
// states for a control code: not in DE yet (total 0), in DE but never billed
// (total > 0, withBillCode 0, correctly absent from Claims Query), or billed
// (withBillCode > 0, should show up exactly that many times).
//
// DbConnection.query() takes a raw SQL string with no parameter binding, so
// the control code is validated against an allowlist pattern before being
// interpolated — it's expected to always be plain alphanumeric. SUM() over
// zero matching rows returns NULL (not 0), hence the `?? 0` fallback.
type ClaimDetailCounts = { total: number; withBillCode: number };

async function fetchClaimDetailCounts(dbConnection: DbConnection, controlCode: string): Promise<ClaimDetailCounts> {
    if (!/^[A-Za-z0-9]+$/.test(controlCode)) {
        throw new Error(`Control code "${controlCode}" contains unexpected characters — refusing to build a query from it.`);
    }

    const rows = await dbConnection.query<{ total: number; with_bill_code: number | null }>(
        `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN medicard_bill_code IS NOT NULL AND medicard_bill_code <> '' THEN 1 ELSE 0 END) AS with_bill_code
         FROM [dbo].[de_op_tc_claim_details]
         WHERE control_code = '${controlCode}'`,
        `claim detail counts for control code "${controlCode}"`
    );

    return {
        total: rows[0]?.total ?? 0,
        withBillCode: rows[0]?.with_bill_code ?? 0,
    };
}

test.beforeEach(async ({ landingPage, logger }) => {
    await logger.step('NAVIGATE TO LOGIN PAGE', async () => {
        await logger.info(`Opening URL: ${process.env.BASE_URL}`);
        await landingPage.navigate(uiEndPoints.landing);
    });
});

test.describe('Core Claims - Claims Query verification', () => {
    test('Control code(s) appear in Claims Query after intake processing', async ({
        account,
        loginPage,
        landingPage,
        dbConnection,
        logger,
    }) => {
        // Already signed in to Microsoft: the `setup` project (tests/auth.setup.ts)
        // saved the session this test starts from, so no password or OTP here.
        await logger.step('SIGN_IN_WITH_SAVED_SESSION', async () => {
            await loginPage.signInIfPrompted(account.username);
            await landingPage.expectLandingPageVisible();
        });

        let coreClaimsPage!: Page;
        let coreClaimsHomePage!: CoreClaimsHomePage;

        await logger.step('OPEN_CORE_CLAIMS_APP', async () => {
            coreClaimsPage = await landingPage.clickApp('Amplify Health Core Claims');
            coreClaimsHomePage = new CoreClaimsHomePage(coreClaimsPage);

            await coreClaimsHomePage.expectHomePageVisible();
        });

        await logger.step('NAVIGATE_TO_CLAIMS_QUERY', async () => {
            await coreClaimsHomePage.openNavMenu();
            await coreClaimsHomePage.clickSidebarSubMenuItem('claims-menu', 'claims-query-sub-menu', 'Claims Query');
        });

        const claimsQueryPage = new ClaimsQueryPage(coreClaimsPage);

        await logger.step('VERIFY_CLAIMS_QUERY_PAGE', async () => {
            await claimsQueryPage.expectClaimsQueryPageVisible();
        });

        for (const controlCode of await getControlCodes()) {
            await logger.step(`SEARCH_AND_VERIFY_${controlCode}`, async () => {
                const { total, withBillCode } = await fetchClaimDetailCounts(dbConnection, controlCode);
                await claimsQueryPage.searchByControlCode(controlCode);

                if (withBillCode > 0) {
                    // Billed — should show up exactly that many times.
                    await claimsQueryPage.expectControlCodeCount(controlCode, withBillCode);
                } else if (total > 0) {
                    // DE processed it, but it never got a medicard_bill_code —
                    // correctly should NOT appear in Claims Query.
                    await claimsQueryPage.expectControlCodeNotFound(controlCode);
                } else {
                    // Not in DE's table at all — still within the ~15 min
                    // processing window, or a real/historical code checked by
                    // hand. Fall back to a plain presence check.
                    await claimsQueryPage.expectControlCodeFound(controlCode);
                }
            });
        }
    });
});
