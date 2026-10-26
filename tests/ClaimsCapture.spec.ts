import type { Page } from '@playwright/test';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
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

// "MALE" and "PRINCIPAL" confirmed against the real dropdowns — both are
// all-caps enums (Gender: "Not Selected"/"MALE"/"FEMALE"/"OTHER"; Participation:
// "Not Selected"/"PRINCIPAL"/"SPOUSE"/"CHILD"/"DEPENDANT"). getByRole's
// exact:true matching is case-sensitive, which is also why exact:true is
// required here at all — "MALE" is literally a substring of "FEMALE".
// "Juan Dela Cruz" is the standard Filipino placeholder name (the "John Doe"
// equivalent), not a real person.
const SAMPLE_MEMBER = {
    entityNo: '1',
    firstName: 'Juan',
    surname: 'Dela Cruz',
    dateOfBirth: '1990-01-01',
    gender: 'MALE',
    nationalIdentificationNumber: '000000000000',
    participation: 'PRINCIPAL', // this member is the primary/main member
    depNo: '0',
    terminateDate: POLICY_END_DATE,
    markAsPatient: true, // only member being added — "exactly one patient per claim"
};

// Fixed sample data for the Covered Providers "Add Provider" row — Provider
// Id/Provider Name are the only required fields (Provider Role already
// defaults to "BILLING"). The rest are optional plain text/number fields.
const SAMPLE_PROVIDER = {
    providerId: 'PROV-0001',
    providerName: 'Sample Provider Clinic',
    providerFlag: 'No',
    billingGracePeriod: '30',
    loaEndorsement: 'LOA-0001',
    vatPercentage: '12',
    withholdingTax: '2',
    discountTAT: '5',
    preApprovedLimit: '10000',
    promptPaymentType: 'Sample prompt payment type',
    providerDiscountPercentage: '10',
};

// Free-text "as written on the claim" diagnosis — generic sample wording, not
// tied to any real patient record.
const SAMPLE_DIAGNOSIS_DESCRIPTION = 'Acute upper respiratory infection, unspecified';

// Fixed sample data for Items → Line 1. The Care Team member reuses the
// covered provider above, so the line's treating provider is one the claim
// already knows about.
const SAMPLE_CLAIM_LINE = {
    dateOfService: today,
    treatmentStartDate: today,
    treatmentEndDate: today,
    quantity: '1',
    originalDescription: 'Sample consultation',
    careTeamProviderId: SAMPLE_PROVIDER.providerId,
    careTeamProviderName: SAMPLE_PROVIDER.providerName,
    // TODO: confirm against the real "Amount Type" dropdown — its options
    // weren't in the captured DOM (overlay renders on open). Placeholder.
    financialAmountType: 'CLAIMED',
    financialAmount: '1000',

     financialAmountType_2: 'CLAIMED_TOTAL',
    financialAmount_2: '500',
};

// Items → Line 2, added via "Add Item". Same date, provider and amount type as
// Line 1 — only the description and amount differ, so the two lines are
// distinguishable on Review without introducing new unconfirmed values.
const SAMPLE_CLAIM_LINE_2 = {
    ...SAMPLE_CLAIM_LINE,
    originalDescription: 'Sample laboratory test',
    financialAmount: '500',
};

// Items → Treatment Codes, added via "Edit Treatment". Confirmed working
// against the live code search.
const SAMPLE_TREATMENT_CODE = '63963009';

// Claim Overview → Header Financial Amounts. The claim-level amount is set to
// the sum of the item lines (1000 + 500), on the assumption the header total
// should reconcile with them. Same unconfirmed Amount Type as the lines, so
// one fix to that placeholder covers both.
const SAMPLE_HEADER_FINANCIAL_AMOUNT = {
    amountType: SAMPLE_CLAIM_LINE.financialAmountType,
    amount: String(Number(SAMPLE_CLAIM_LINE.financialAmount) + Number(SAMPLE_CLAIM_LINE_2.financialAmount)),
};

const SAMPLE_HEADER_FINANCIAL_AMOUNT_2 = {
    amountType: SAMPLE_CLAIM_LINE.financialAmountType_2,
    amount: String(Number(SAMPLE_CLAIM_LINE.financialAmount_2) + Number(SAMPLE_CLAIM_LINE_2.financialAmount)),
};
test.beforeEach(async ({ landingPage, logger }) => {
    await logger.step('NAVIGATE TO LOGIN PAGE', async () => {
        await logger.info(`Opening URL: ${process.env.BASE_URL}`);
        await landingPage.navigate(uiEndPoints.landing);
    });
});

test.describe('Core Claims - Manual Claim Capture', () => {
    test('Navigates to the Claims Capture page', async ({ account, loginPage, landingPage, logger }) => {
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

        await logger.step('ADD_COVERED_PROVIDER', async () => {
            await claimCaptureFormPage.addProvider(SAMPLE_PROVIDER);
        });

        await logger.step('ADD_HEADER_FINANCIAL_AMOUNT', async () => {
            await claimCaptureFormPage.addHeaderFinancialAmount(
                SAMPLE_HEADER_FINANCIAL_AMOUNT_2.amountType,
                SAMPLE_HEADER_FINANCIAL_AMOUNT_2.amount
            );

        });
        await logger.step('ADD_COVERED_PROVIDER 2', async () =>{
                await claimCaptureFormPage.addHeaderFinancialAmount(
                SAMPLE_HEADER_FINANCIAL_AMOUNT.amountType,
                SAMPLE_HEADER_FINANCIAL_AMOUNT.amount
            );
        })
        
        await logger.step('CLICK_NEXT_TO_DISCHARGE_SUMMARY', async () => {
            await claimCaptureFormPage.clickNext();
            await claimCaptureFormPage.expectDischargeSummaryVisible();
        });

        // TODO: add the Diagnosis codes via "Edit Diagnosis" once its editor's
        // DOM is captured — it wasn't rendered in the Discharge Summary snapshot.
        await logger.step('FILL_DISCHARGE_SUMMARY', async () => {
            await claimCaptureFormPage.fillDiagnosisDescription(SAMPLE_DIAGNOSIS_DESCRIPTION);
        });

        await logger.step('CLICK_NEXT_TO_ITEMS', async () => {
            await claimCaptureFormPage.clickNext();
            // await claimCaptureFormPage.expectItemsVisible();
        });

        await logger.step('ADD_ITEM_LINE_2', async () => {
            await claimCaptureFormPage.addItem(SAMPLE_CLAIM_LINE_2);
            // await page.pause();
        });

        // Applies to the line still selected after ADD_ITEM_LINE_2 (Line 2).
        await logger.step('ADD_TREATMENT_CODE_LINE_2', async () => {
            await claimCaptureFormPage.addTreatmentCode(SAMPLE_TREATMENT_CODE);
        });


        await logger.step('CLICK_NEXT_TO_REVIEW', async () => {
            await claimCaptureFormPage.clickNext();
            await claimCaptureFormPage.expectReviewVisible();
        });

        // Before the ready-to-submit check, so the draft is kept even when
        // blocking validations fail that step — it can then be reopened from
        // the drafts list to see what was captured.
        await logger.step('SAVE_DRAFT', async () => {
            await claimCaptureFormPage.saveDraft();
            await claimCaptureFormPage.expectDraftSaved();
        });

        // Stops short of clicking Submit Claim: that creates a real claim in
        // the target environment, and the post-submit screen hasn't been captured.
        await logger.step('VERIFY_REVIEW_READY_TO_SUBMIT', async () => {
            await claimCaptureFormPage.expectNoBlockingValidations();
            await claimCaptureFormPage.expectSubmitClaimEnabled();
        });
    });
});
