import type { Page } from '@playwright/test';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { SKIPPED_STAGES } from '@constants/tracker.config.ts';
import { CoreClaimsHomePage } from '@pages/core-claims-home.page.ts';
import { ClaimsQueryPage } from '@pages/claims-query.page.ts';
import type { LoginPage } from '@pages/login.page.ts';
import type { LandingPage } from '@pages/landing.page.ts';
import type { TestAccount } from '@root/playwright.config.ts';
import type { SmartLogger } from '@utils/logger/SmartLogger.util.ts';
import { fetchClaimDetailCounts, type ClaimDetailCounts } from '@utils/deSignals.util.ts';
import type { ControlCodeTracker, StageUpdate } from '@utils/tracker/ControlCodeTracker.util.ts';

const ACTOR = 'ClaimsQueryCheck.spec.ts';

// While S3 is skipped there is no DE database access (SKIPPED_STAGES in
// tracker.config.ts), so the expected row counts can't be read either: S4
// only checks that each code shows up in Claims Query.
const DE_COUNTS_AVAILABLE = !SKIPPED_STAGES.S3_INTAKE_PROCESSED;

// CONTROL_CODE overrides the tracker — same override-wins pattern as
// EP_NUMBER_DPS/UB in scripts/generate-return-file.ts — for spot-checking a
// specific or real/historical code by hand. A spot check is NOT recorded in
// the Control Code Tracker; only tracker-selected codes are.
//
//   PowerShell:  $env:CONTROL_CODE='OPEML2026101900015T'; npx playwright test tests/ClaimsQueryCheck.spec.ts
//   bash:        CONTROL_CODE='OPEML2026101900015T' npx playwright test tests/ClaimsQueryCheck.spec.ts
function spotCheckCodes(): string[] | undefined {
    const raw = process.env.CONTROL_CODE;
    return raw ? raw.split(',').map((code) => code.trim()).filter(Boolean) : undefined;
}

type CheckFixtures = {
    account: TestAccount;
    loginPage: LoginPage;
    landingPage: LandingPage;
    tracker: ControlCodeTracker;
    logger: SmartLogger;
};

/**
 * Stage S4 of the Control Code Tracker — the "is it in Core Claims yet?"
 * check that used to be done by hand. Without CONTROL_CODE, it checks every
 * code whose intake processing (S3) has passed or is skipped, and records the
 * result; re-running skips codes already PASSED. `deCounts` reads DE's
 * expected row counts; without it, only presence is checked.
 */
async function checkClaimsQuery(
    { account, loginPage, landingPage, tracker, logger }: CheckFixtures,
    deCounts?: (controlCode: string) => Promise<ClaimDetailCounts>
): Promise<void> {
    const spotCheck = spotCheckCodes();
    if (!spotCheck) {
        // Codes already waiting at a stage that has since been skipped.
        const skipped = await tracker.applySkippedStages(ACTOR);
        if (skipped.length > 0) logger.info(`Skipped stage(s) marked N/A for: ${skipped.join(', ')}`);
    }

    const controlCodes = spotCheck ?? (await tracker.getEligible('S4_CORECLAIMS_VISIBLE')).map((code) => code.controlCode);
    test.skip(controlCodes.length === 0, 'No control code is due for the Claims Query check (needs S3 PASSED or skipped in the tracker).');

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

    // Intake processing takes ~15 min to land in DE, and not every intake
    // row ends up with a medicard_bill_code at all — both are normal, not
    // bugs. So `total` and `withBillCode` tell apart three real states for
    // a control code: not in DE yet (total 0), in DE but never billed
    // (total > 0, withBillCode 0, correctly absent from Claims Query), or
    // billed (withBillCode > 0, should show up exactly that many times).
    const verify = async (controlCode: string): Promise<StageUpdate> => {
        if (!deCounts) {
            // Every generated intake file has at least one complete row, so
            // every code should show up once DE has processed it.
            await claimsQueryPage.searchByControlCode(controlCode);
            await claimsQueryPage.expectControlCodeFound(controlCode);
            return { detail: 'presence check only — no DE database access (S3 skipped)' };
        }

        const { total, withBillCode } = await deCounts(controlCode);
        await claimsQueryPage.searchByControlCode(controlCode);

        if (withBillCode > 0) {
            // Billed — should show up exactly that many times.
            await claimsQueryPage.expectControlCodeCount(controlCode, withBillCode);
            return { fields: { expectedRefCount: withBillCode, foundRefCount: withBillCode }, detail: `${withBillCode} Account Ref. No. row(s) shown` };
        }
        if (total > 0) {
            // DE processed it, but it never got a medicard_bill_code —
            // correctly should NOT appear in Claims Query.
            await claimsQueryPage.expectControlCodeNotFound(controlCode);
            return { fields: { expectedRefCount: 0, foundRefCount: 0 }, detail: `${total} DE claim line(s), none billed — correctly absent` };
        }
        // Not in DE's table at all — still within the ~15 min processing
        // window, or a real/historical code checked by hand. Fall back to
        // a plain presence check.
        await claimsQueryPage.expectControlCodeFound(controlCode);
        return { detail: 'not in de_op_tc_claim_details — presence check only' };
    };

    for (const controlCode of controlCodes) {
        await logger.step(`SEARCH_AND_VERIFY_${controlCode}`, async () => {
            if (spotCheck) {
                await verify(controlCode);
            } else {
                await tracker.runStage(controlCode, 'S4_CORECLAIMS_VISIBLE', ACTOR, () => verify(controlCode));
            }
        });
    }
}

test.beforeEach(async ({ landingPage, logger }) => {
    await logger.step('NAVIGATE TO LOGIN PAGE', async () => {
        await logger.info(`Opening URL: ${process.env.BASE_URL}`);
        await landingPage.navigate(uiEndPoints.landing);
    });
});

test.describe('Core Claims - Claims Query verification', () => {
    if (DE_COUNTS_AVAILABLE) {
        test('Control code(s) appear in Claims Query after intake processing', async ({ account, loginPage, landingPage, dbConnection, tracker, logger }) => {
            await checkClaimsQuery({ account, loginPage, landingPage, tracker, logger }, (controlCode) => fetchClaimDetailCounts(dbConnection, controlCode));
        });
    } else {
        // No `dbConnection` here: requesting the fixture opens the connection,
        // which fails without DE database access.
        test('Control code(s) appear in Claims Query (presence only, no DE database access)', async ({ account, loginPage, landingPage, tracker, logger }) => {
            await checkClaimsQuery({ account, loginPage, landingPage, tracker, logger });
        });
    }
});
