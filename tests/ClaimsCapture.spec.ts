import type { Page } from '@playwright/test';
import { test } from '@fixtures/base.fixture.ts';
import { test_credentials } from '@root/playwright.config.ts';
import { CoreClaimsHomePage } from '@pages/core-claims-home.page.ts';
import { ClaimsCapturePage } from '@pages/claims-capture.page.ts';
import { ClaimCaptureFormPage } from '@pages/claim-capture-form.page.ts';

// YYYY-MM-DD, matching the calendar fields' dateformat="yy-mm-dd" / placeholder.
const today = new Date().toISOString().slice(0, 10);

const oneYearFromNow = new Date();
oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
const POLICY_END_DATE = oneYearFromNow.toISOString().slice(0, 10);

// TODO: confirm this is a real, selectable currency code in the "Claim currency"
// dropdown — placeholder until the dropdown's actual options are confirmed.
const CLAIM_CURRENCY_CODE = 'PHP';

// TODO: replace with a real Policy ID / Card ID (and matching policy dates) —
// these tie the claim to an actual member record, so a placeholder will likely
// fail server-side validation even though the form itself accepts it.
const POLICY_ID = '00000000';
const CARD_ID = '00000000';

// Fixed sample data for the Plan Details "Add Plan" row — deliberately not
// randomized, so a failing run is reproducible.
const SAMPLE_PLAN = {
    productId: '1001',
    planCode: 'PLAN-SAMPLE-001',
    planName: 'Sample Plan',
    contractStart: today,
    contractEnd: POLICY_END_DATE,
};

// TODO: "Male" / "Primary" are unverified guesses at the actual option text in
// the Gender / Participation dropdowns — confirm against the real dropdowns.
// "Juan Dela Cruz" is the standard Filipino placeholder name (the "John Doe"
// equivalent), not a real person.
const SAMPLE_MEMBER = {
    entityNo: '1',
    firstName: 'Juan',
    surname: 'Dela Cruz',
    dateOfBirth: '1990-01-01',
    gender: 'Male',
    nationalIdentificationNumber: '000000000000',
    participation: 'Primary',
    depNo: '0',
    terminateDate: POLICY_END_DATE,
    markAsPatient: true, // only member being added — "exactly one patient per claim"
};

test.beforeEach(async ({ loginPage, logger }) => {
    await logger.step('NAVIGATE TO LOGIN PAGE', async () => {
        await logger.info(`Opening URL: ${process.env.BASE_URL}`);
        await loginPage.navigate();
    });
});

test.describe('Core Claims - Manual Claim Capture', () => {
    test('Navigates to the Claims Capture page', async ({ loginPage, microsoftLoginPage, landingPage, logger }) => {
        await logger.step('LOGIN_VIA_MICROSOFT_SSO', async () => {
            await loginPage.login(test_credentials.valid_username_1);
            await microsoftLoginPage.login(
                test_credentials.valid_username_1,
                test_credentials.valid_password_1,
                test_credentials.valid_otp_secret_1
            );
            await microsoftLoginPage.expectRedirectedBackToApp();
        });

        let coreClaimsPage!: Page;
        let coreClaimsHomePage!: CoreClaimsHomePage;

        await logger.step('OPEN_CORE_CLAIMS_APP', async () => {
            coreClaimsPage = await landingPage.clickApp('Amplify Health Core Claims');
            coreClaimsHomePage = new CoreClaimsHomePage(coreClaimsPage);

            await coreClaimsHomePage.expectHomePageVisible();
        });

        await logger.step('NAVIGATE_TO_CLAIMS_CAPTURE', async () => {
            await coreClaimsHomePage.openNavMenu();
            await coreClaimsHomePage.clickSidebarSubMenuItem('claims-menu', 'claims-capture-v2-sub-menu', 'Claims Capture');
        });

        let claimsCapturePage!: ClaimsCapturePage;

        await logger.step('VERIFY_CLAIMS_CAPTURE_PAGE', async () => {
            claimsCapturePage = new ClaimsCapturePage(coreClaimsPage);
            await claimsCapturePage.expectClaimsCapturePageVisible();
        });

        let claimCaptureFormPage!: ClaimCaptureFormPage;

        await logger.step('CREATE_CLAIM', async () => {
            claimCaptureFormPage = await claimsCapturePage.clickCreateClaim();
        });

        await logger.step('FILL_CLAIM_CONTROL_REQUIRED_FIELDS', async () => {
            await claimCaptureFormPage.fillClaimControlRequiredFields(today, today, CLAIM_CURRENCY_CODE);
        });

        await logger.step('CLICK_NEXT_TO_CLAIM_OVERVIEW', async () => {
            await claimCaptureFormPage.clickNext();
        });

        await logger.step('FILL_CLAIM_OVERVIEW_REQUIRED_FIELDS', async () => {
            await claimCaptureFormPage.fillClaimOverviewRequiredFields(
                today,
                POLICY_ID,
                CARD_ID,
                today,
                POLICY_END_DATE
            );
        });

        await logger.step('ADD_PLAN_DETAILS', async () => {
            await claimCaptureFormPage.addPlan(
                SAMPLE_PLAN.productId,
                SAMPLE_PLAN.planCode,
                SAMPLE_PLAN.planName,
                SAMPLE_PLAN.contractStart,
                SAMPLE_PLAN.contractEnd
            );
        });

        await logger.step('ADD_COVERED_MEMBER', async () => {
            await claimCaptureFormPage.addMember(SAMPLE_MEMBER);
        });

        await logger.step('CLICK_NEXT_TO_DISCHARGE_SUMMARY', async () => {
            await claimCaptureFormPage.clickNext();
        });
    });
});
