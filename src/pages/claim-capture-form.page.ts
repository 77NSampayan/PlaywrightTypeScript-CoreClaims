import type { Page, Locator } from "@playwright/test";
import { BasePage } from "@base/base.page.ts";

// One object param rather than ~15 positional strings — the Member Editor has
// far more fields than Claim Control/Overview did, and most are optional.
export type CoveredMemberInput = {
    entityNo: string;
    firstName: string;
    surname: string;
    dateOfBirth: string;
    gender: string;
    nationalIdentificationNumber: string;
    participation: string;
    depNo: string;
    terminateDate: string;
    // Not asterisked/aria-invalid in the markup, but required by business rule
    // ("exactly one patient can be marked per claim") — required in the type so
    // no caller can silently forget it, unlike the genuinely optional fields below.
    markAsPatient: boolean;
    dateOfDeath?: string;
    identifier?: string;
    initials?: string;
    joinDate?: string;
    memberStatus?: string;
    yearsOfMembership?: string;
    membersPhilHealth?: string;
};

// Provider Editor has ~20 fields but only Provider Id/Provider Name carry
// aria-invalid="true" — Provider Role already defaults to "BILLING" (ng-valid,
// no asterisk-with-aria-invalid). The remaining optional fields below are the
// plain text/number ones; the three Yes/No-style dropdowns (Taxable, Advance
// approved, VAT registered), the Practice Type/Country dropdowns, and the
// nested Provider Categories/Networks sub-lists are deliberately left out —
// none are required (valid empty/"Not captured" defaults) and their real
// option values haven't been confirmed against the live app yet.
export type CoveredProviderInput = {
    providerId: string;
    providerName: string;
    providerFlag?: string;
    billingGracePeriod?: string;
    loaEndorsement?: string;
    vatPercentage?: string;
    withholdingTax?: string;
    discountTAT?: string;
    preApprovedLimit?: string;
    promptPaymentType?: string;
    providerDiscountPercentage?: string;
};

// One claim line on the "4. Items" section. Required by the form: Date Of
// Service, one Care Team member (Provider id/name) and one Financial Amount
// (type + amount). Claim Line Type ("TREATMENT") and Cost Center Id arrive
// pre-filled and valid, so they're left alone. Dropdowns whose option values
// haven't been confirmed (Place Of Service, Quantity Type, the two
// "Applicable" flags, Care Team Practice type) are deliberately left out, as
// are the Treatment/Diagnostic code editors, whose markup wasn't captured.
export type ClaimLineInput = {
    dateOfService: string;
    careTeamProviderId: string;
    careTeamProviderName: string;
    financialAmountType: string;
    financialAmount: string;
    treatmentStartDate?: string;
    treatmentEndDate?: string;
    quantity?: string;
    originalDescription?: string;
};

export class ClaimCaptureFormPage extends BasePage {

    protected readonly pageHeading: Locator;

    // "1. Claim Control" section — required fields
    protected readonly receivedDateInput: Locator;
    protected readonly capturedDateInput: Locator;
    protected readonly claimCurrencyDropdown: Locator;

    // "2. Claim Overview" section — required fields. "Policy Active Status" also
    // carries a "*" but arrives pre-filled ("ACTIVE") with no aria-invalid, same
    // as "Received channel type" on the Claim Control section — left alone.
    protected readonly accountDateInput: Locator;
    protected readonly policyIdInput: Locator;
    protected readonly cardIdInput: Locator;
    protected readonly policyStartInput: Locator;
    protected readonly policyEndInput: Locator;

    // "2. Claim Overview" — Plan Details sub-section. Scoped under this
    // section's own id so an "Add"/"Add Plan" collision with the other
    // repeatable sections (Covered Members, Providers, ...) can't happen,
    // since they likely follow the same editor-fieldset-plus-"Add" pattern.
    protected readonly planDetailsSection: Locator;
    protected readonly addPlanButton: Locator;
    protected readonly planProductIdInput: Locator;
    protected readonly planCodeInput: Locator;
    protected readonly planNameInput: Locator;
    protected readonly planContractStartInput: Locator;
    protected readonly planContractEndInput: Locator;
    protected readonly confirmAddPlanButton: Locator;

    // "2. Claim Overview" — Covered Members sub-section. Same editor-fieldset-
    // plus-"Add" pattern and same scoping reasoning as Plan Details above.
    protected readonly coveredMembersSection: Locator;
    protected readonly addMemberButton: Locator;
    protected readonly memberEntityNoInput: Locator;
    protected readonly memberFirstNameInput: Locator;
    protected readonly memberSurnameInput: Locator;
    protected readonly memberDateOfBirthInput: Locator;
    protected readonly memberDateOfDeathInput: Locator;
    protected readonly memberGenderDropdown: Locator;
    protected readonly memberNationalIdInput: Locator;
    protected readonly memberIdentifierInput: Locator;
    protected readonly memberInitialsDropdown: Locator;
    protected readonly memberParticipationDropdown: Locator;
    protected readonly memberDepNoInput: Locator;
    protected readonly memberJoinDateInput: Locator;
    protected readonly memberTerminateDateInput: Locator;
    protected readonly memberStatusInput: Locator;
    protected readonly memberYearsOfMembershipInput: Locator;
    // Native checkbox input is visually hidden (PrimeNG's accessibility pattern)
    // — the actual clickable element is its styled box, so click() not check().
    protected readonly memberIsPatientCheckbox: Locator;
    protected readonly memberPhilHealthDropdown: Locator;
    protected readonly confirmAddMemberButton: Locator;

    // "2. Claim Overview" — Covered Providers sub-section. Same editor-fieldset-
    // plus-"Add" pattern and same scoping reasoning as Plan Details/Covered
    // Members above. Only Provider Id/Provider Name are required — Provider
    // Role already defaults to "BILLING" (ng-valid, no aria-invalid).
    protected readonly coveredProvidersSection: Locator;
    protected readonly addProviderButton: Locator;
    protected readonly providerIdInput: Locator;
    protected readonly providerNameInput: Locator;
    protected readonly providerFlagInput: Locator;
    protected readonly billingGracePeriodInput: Locator;
    protected readonly loaEndorsementInput: Locator;
    protected readonly vatPercentageInput: Locator;
    protected readonly withholdingTaxInput: Locator;
    protected readonly discountTATInput: Locator;
    protected readonly preApprovedLimitInput: Locator;
    // formgroupname="promptPaymentType" > formcontrolname="description" — scoped
    // narrowly since "description" alone is reused elsewhere on the form (e.g.
    // Claim Control's received-channel description).
    protected readonly promptPaymentTypeInput: Locator;
    protected readonly providerDiscountPercentageInput: Locator;
    protected readonly confirmAddProviderButton: Locator;

    // "2. Claim Overview" — Header Financial Amounts sub-section: the same
    // <app-financial-amounts-editor> as each Items line uses, here at claim
    // level. Rows are edited in place (no editor-plus-"Add" confirm step).
    protected readonly headerFinancialAmountsSection: Locator;
    protected readonly addHeaderFinancialAmountButton: Locator;

    // "3. Discharge Summary" section. The Diagnosis sub-section's "Edit
    // Diagnosis" editor wasn't in the captured DOM, so only the free-text
    // Original Diagnosis Description is covered so far.
    protected readonly dischargeSummarySection: Locator;
    protected readonly originalDiagnosisHeading: Locator;
    protected readonly diagnosisHeading: Locator;
    protected readonly diagnosisDescriptionInput: Locator;

    // "4. Items" section. Only the selected line's editor is rendered (the
    // left-hand line cards switch it), as <fieldset id="claim-validation-claimLines-N">
    // — so everything below is scoped to "whichever line is active" rather
    // than hard-coding index 0.
    protected readonly itemsSection: Locator;
    protected readonly itemsHeading: Locator;
    protected readonly addItemButton: Locator;
    // Left-hand list, one card per line ("Line 1", "Line 2", ...); clicking a
    // card swaps which line the editor on the right shows.
    protected readonly lineCards: Locator;
    protected readonly activeClaimLine: Locator;
    protected readonly dateOfServiceInput: Locator;
    protected readonly treatmentStartDateInput: Locator;
    protected readonly treatmentEndDateInput: Locator;
    protected readonly quantityInput: Locator;
    protected readonly originalDescriptionInput: Locator;
    protected readonly careTeamSection: Locator;
    protected readonly addCareTeamMemberButton: Locator;
    protected readonly financialAmountsSection: Locator;
    protected readonly addFinancialAmountButton: Locator;

    // "4. Items" — Treatment Codes. "Edit Treatment" opens a full-screen
    // <app-treatment-popup> dialog (rendered under <app-items>, outside the
    // line's fieldset): search + results on the left, the line's selected codes
    // on the right, Cancel/Update in the header. Update is disabled until a
    // selection changes.
    protected readonly editTreatmentButton: Locator;
    protected readonly treatmentDialog: Locator;
    protected readonly treatmentSearchInput: Locator;
    protected readonly treatmentSearchResultsTable: Locator;
    protected readonly selectedTreatmentCodesTable: Locator;
    protected readonly treatmentDialogUpdateButton: Locator;

    // "5. Review" section — read-only summary, no inputs. A red panel headed
    // "N blocking validation(s)" lists every outstanding error (each with a
    // "Go to <section>" link) and is absent once there are none; Submit Claim
    // stays disabled until then.
    protected readonly reviewSection: Locator;
    protected readonly reviewHeading: Locator;
    protected readonly blockingValidationsPanel: Locator;
    protected readonly blockingValidationsList: Locator;

    // The app shell's single <p-toast> (bottom-left), shared by every section.
    protected readonly draftSavedToast: Locator;

    protected readonly nextButton: Locator;
    protected readonly submitClaimButton: Locator;
    protected readonly saveDraftButton: Locator;
    protected readonly exitButton: Locator;

    constructor(page: Page) {
        super(page);    // Passes page up to BasePage

        this.pageHeading = this.page.getByRole('heading', { name: 'Claim capture' });

        this.receivedDateInput     = this.page.locator('p-calendar[formcontrolname="receivedDate"] input');
        this.capturedDateInput     = this.page.locator('p-calendar[formcontrolname="capturedDate"] input');
        // No formcontrolname exposed on this dropdown — scoped by its wrapping
        // label's id instead, which stays stable regardless of selection state
        // (unlike the dropdown's own aria-label, which changes to the picked value).
        // Targets [role="combobox"], not the outer <p-dropdown> tag: that wrapper
        // is a component host element and may render with no box of its own, in
        // which case a click on it never lands on the real widget underneath.
        this.claimCurrencyDropdown = this.page.locator('#claim-validation-claimCurrency p-dropdown [role="combobox"]');

        this.accountDateInput = this.page.locator('p-calendar[formcontrolname="accountDate"] input');
        this.policyIdInput    = this.page.locator('input[formcontrolname="policyId"]');
        this.cardIdInput      = this.page.locator('input[formcontrolname="cardId"]');
        this.policyStartInput = this.page.locator('p-calendar[formcontrolname="policyStart"] input');
        this.policyEndInput   = this.page.locator('p-calendar[formcontrolname="policyEnd"] input');

        this.planDetailsSection    = this.page.locator('#claim-validation-claimHeader-coveredPolicy-plans');
        this.addPlanButton         = this.planDetailsSection.getByRole('button', { name: 'Add Plan', exact: true });
        this.planProductIdInput    = this.planDetailsSection.locator('input[formcontrolname="productId"]');
        this.planCodeInput         = this.planDetailsSection.locator('input[formcontrolname="planCode"]');
        this.planNameInput         = this.planDetailsSection.locator('input[formcontrolname="planName"]');
        this.planContractStartInput = this.planDetailsSection.locator('p-calendar[formcontrolname="contractStart"] input');
        this.planContractEndInput   = this.planDetailsSection.locator('p-calendar[formcontrolname="contractEnd"] input');
        this.confirmAddPlanButton  = this.planDetailsSection.getByRole('button', { name: 'Add', exact: true });

        this.coveredMembersSection = this.page.locator('#claim-validation-claimHeader-coveredPolicy-coveredEntities');
        this.addMemberButton      = this.coveredMembersSection.getByRole('button', { name: 'Add Member', exact: true });
        this.memberEntityNoInput  = this.coveredMembersSection.locator('input[formcontrolname="entityNo"]');
        this.memberFirstNameInput = this.coveredMembersSection.locator('input[formcontrolname="firstName"]');
        this.memberSurnameInput   = this.coveredMembersSection.locator('input[formcontrolname="surname"]');
        this.memberDateOfBirthInput = this.coveredMembersSection.locator('p-calendar[formcontrolname="dateOfBirth"] input');
        this.memberDateOfDeathInput = this.coveredMembersSection.locator('p-calendar[formcontrolname="dateOfDeath"] input');
        this.memberGenderDropdown  = this.coveredMembersSection.locator('p-dropdown[formcontrolname="gender"] [role="combobox"]');
        this.memberNationalIdInput = this.coveredMembersSection.locator('input[formcontrolname="nationalIdentificationNumber"]');
        this.memberIdentifierInput = this.coveredMembersSection.locator('input[formcontrolname="identifier"]');
        this.memberInitialsDropdown = this.coveredMembersSection.locator('p-dropdown[formcontrolname="initials"] [role="combobox"]');
        this.memberParticipationDropdown = this.coveredMembersSection.locator('p-dropdown[formcontrolname="participation"] [role="combobox"]');
        this.memberDepNoInput      = this.coveredMembersSection.locator('input[formcontrolname="depNo"]');
        this.memberJoinDateInput   = this.coveredMembersSection.locator('p-calendar[formcontrolname="joinDate"] input');
        this.memberTerminateDateInput = this.coveredMembersSection.locator('p-calendar[formcontrolname="terminateDate"] input');
        // formgroupname="status" > formcontrolname="id" — scoped narrowly since
        // "id" alone would be far too generic a formcontrolname to search on.
        this.memberStatusInput    = this.coveredMembersSection.locator('fieldset[formgroupname="status"] input[formcontrolname="id"]');
        this.memberYearsOfMembershipInput = this.coveredMembersSection.locator('input[formcontrolname="yearsOfMembership"]');
        this.memberIsPatientCheckbox = this.coveredMembersSection.locator('p-checkbox[formcontrolname="isPatient"] .p-checkbox-box');
        this.memberPhilHealthDropdown = this.coveredMembersSection.locator('p-dropdown[formcontrolname="isMembersPhilHealth"] [role="combobox"]');
        this.confirmAddMemberButton = this.coveredMembersSection.getByRole('button', { name: 'Add', exact: true });

        this.coveredProvidersSection = this.page.locator('#claim-validation-claimHeader-billingTeam');
        this.addProviderButton    = this.coveredProvidersSection.getByRole('button', { name: 'Add Provider', exact: true });
        this.providerIdInput      = this.coveredProvidersSection.locator('input[formcontrolname="providerId"]');
        this.providerNameInput    = this.coveredProvidersSection.locator('input[formcontrolname="providerName"]');
        this.providerFlagInput    = this.coveredProvidersSection.locator("p-dropdown[formcontrolname='providerFlag'] div[role='button']");
        this.billingGracePeriodInput = this.coveredProvidersSection.locator('p-inputnumber[formcontrolname="billingGracePeriod"] input');
        this.loaEndorsementInput  = this.coveredProvidersSection.locator('input[formcontrolname="loaEndorsement"]');
        this.vatPercentageInput   = this.coveredProvidersSection.locator('p-inputnumber[formcontrolname="vatPercentage"] input');
        this.withholdingTaxInput  = this.coveredProvidersSection.locator('p-inputnumber[formcontrolname="withholdingTax"] input');
        this.discountTATInput     = this.coveredProvidersSection.locator('p-inputnumber[formcontrolname="quantity"]');
        this.preApprovedLimitInput = this.coveredProvidersSection.locator('p-inputnumber[formcontrolname="preApprovedLimit"] input');
        this.promptPaymentTypeInput = this.coveredProvidersSection.locator('fieldset[formgroupname="promptPaymentType"] input[formcontrolname="description"]');
        this.providerDiscountPercentageInput = this.coveredProvidersSection.locator('p-inputnumber[formcontrolname="providerDiscountPercentage"] input');
        this.confirmAddProviderButton = this.coveredProvidersSection.getByRole('button', { name: 'Add', exact: true });

        this.headerFinancialAmountsSection  = this.page.locator('#claim-validation-claimHeader-financialAmounts');
        this.addHeaderFinancialAmountButton = this.headerFinancialAmountsSection.getByRole('button', { name: 'Add amount', exact: true });

        this.dischargeSummarySection = this.page.locator('app-discharge-summary');
        this.originalDiagnosisHeading = this.dischargeSummarySection.getByRole('heading', { name: 'Original Diagnosis Description', exact: true });
        this.diagnosisHeading         = this.dischargeSummarySection.getByRole('heading', { name: 'Diagnosis', exact: true });
        // The <textarea> sits inside its <label>, so getByLabel() would work —
        // until something's typed: an embedded textbox's value becomes part of
        // its own accessible name, so the same locator stops matching after
        // fill(). Located through the wrapping label instead.
        this.diagnosisDescriptionInput = this.dischargeSummarySection
            .locator('label', { hasText: 'Diagnosis Description' })
            .locator('textarea');

        this.itemsSection    = this.page.locator('app-items');
        this.itemsHeading    = this.itemsSection.getByRole('heading', { name: 'Items', exact: true });
        this.addItemButton   = this.itemsSection.getByRole('button', { name: 'Add Item', exact: true });
        this.lineCards       = this.itemsSection.locator('button.cc-line-card');
        // fieldset[id^=...] — the nested ids under a line (…-0-dateOfService,
        // …-0-financialAmounts) sit on <label>/<section>/<td>, never <fieldset>,
        // and the line list itself is an <aside>, so this matches only the line editor.
        this.activeClaimLine = this.itemsSection.locator('fieldset[id^="claim-validation-claimLines-"]');
        this.dateOfServiceInput       = this.activeClaimLine.locator('p-calendar[formcontrolname="dateOfService"] input');
        this.treatmentStartDateInput  = this.activeClaimLine.locator('p-calendar[formcontrolname="treatmentStartDate"] input');
        this.treatmentEndDateInput    = this.activeClaimLine.locator('p-calendar[formcontrolname="treatmentEndDate"] input');
        this.quantityInput            = this.activeClaimLine.locator('p-inputnumber[formcontrolname="quantity"] input');
        this.originalDescriptionInput = this.activeClaimLine.locator('input[formcontrolname="originalDescription"]');

        this.careTeamSection = this.activeClaimLine
            .locator('section.cc-section')
            .filter({ has: this.page.getByRole('heading', { name: 'Care Team', exact: true }) });
        this.addCareTeamMemberButton = this.careTeamSection.getByRole('button', { name: 'Add Care Team Member', exact: true });

        this.financialAmountsSection  = this.activeClaimLine.locator('app-financial-amounts-editor');
        this.addFinancialAmountButton = this.financialAmountsSection.getByRole('button', { name: 'Add amount', exact: true });

        this.editTreatmentButton = this.activeClaimLine
            .locator('section.cc-section')
            .filter({ has: this.page.getByRole('heading', { name: 'Treatment Codes', exact: true }) })
            .getByRole('button', { name: 'Edit Treatment', exact: true });
        this.treatmentDialog      = this.page.locator('app-treatment-popup [role="dialog"]');
        this.treatmentSearchInput = this.treatmentDialog.getByPlaceholder('Enter at least 3 characters to search');
        // Both panes are PrimeNG tables with Code/Schema/Description columns —
        // only the selected-codes table has "Position", so that tells them apart.
        const positionHeader = this.page.getByRole('columnheader', { name: 'Position', exact: true });
        this.treatmentSearchResultsTable = this.treatmentDialog.locator('table').filter({ hasNot: positionHeader });
        this.selectedTreatmentCodesTable = this.treatmentDialog.locator('table').filter({ has: positionHeader });
        this.treatmentDialogUpdateButton = this.treatmentDialog.getByRole('button', { name: 'Update', exact: true });

        this.reviewSection = this.page.locator('app-claim-capture-review');
        this.reviewHeading  = this.reviewSection.getByRole('heading', { name: 'Review', exact: true });
        // Heading text carries the live count ("15 blocking validation(s)"), so regex.
        this.blockingValidationsPanel = this.reviewSection
            .locator('section')
            .filter({ has: this.page.getByRole('heading', { name: /blocking validation/i }) });
        this.blockingValidationsList = this.blockingValidationsPanel.locator('ul');

        // NOT YET CONFIRMED against the live app — no toast was rendered in any
        // captured DOM. Assumes PrimeNG's standard success-toast markup and a
        // message mentioning "draft". Filtering on the text, not just severity,
        // keeps a still-visible success toast from an earlier action (Add Plan,
        // Add Member, ...) from satisfying the check.
        this.draftSavedToast = this.page
            .locator('p-toast .p-toast-message-success')
            .filter({ hasText: /draft/i });

        this.nextButton     = this.page.getByRole('button', { name: 'Next' });
        this.submitClaimButton = this.page.getByRole('button', { name: 'Submit Claim' });
        this.saveDraftButton   = this.page.getByRole('button', { name: 'Save Draft' });
        this.exitButton        = this.page.getByRole('button', { name: 'Exit' });
    };

    // ─── Actions ──────────────────────────────

    // p-calendar parses the typed date per keystroke — fill() sets the value in
    // bulk with no real key events, so the component never registers it. Clear
    // first so this is idempotent (pressSequentially() types at the cursor, it
    // doesn't replace existing content the way fill() does).
    //
    // Focusing the input opens the calendar overlay (aria-haspopup="dialog").
    // Tab doesn't close it: within p-calendar, tab order goes input → its own
    // "Choose Date" button, both still inside the same widget, so focus never
    // actually leaves it. Escape is the standard way to dismiss the overlay —
    // it only hides the popup, it doesn't revert the value already committed
    // to the form control by the keystrokes above.
    //
    // Shared by every p-calendar field on this form (5 so far across two
    // sections) rather than repeating the same three lines per field.
    private async fillCalendarField(input: Locator, date: string, description: string): Promise<void> {
        await input.clear();
        await this.elements.pressSequentially(input, date, description);
        await input.press('Escape');
    };

    async fillReceivedDate(date: string): Promise<void> {
        await this.fillCalendarField(this.receivedDateInput, date, 'Received date field');
    };

    async fillCapturedDate(date: string): Promise<void> {
        await this.fillCalendarField(this.capturedDateInput, date, 'Captured date field');
    };

    async fillAccountDate(date: string): Promise<void> {
        await this.fillCalendarField(this.accountDateInput, date, 'Account date field');
    };

    async fillPolicyStart(date: string): Promise<void> {
        await this.fillCalendarField(this.policyStartInput, date, 'Policy start field');
    };

    async fillPolicyEnd(date: string): Promise<void> {
        await this.fillCalendarField(this.policyEndInput, date, 'Policy end field');
    };

    // Plain reactive-form-bound text inputs (pInputText, no per-keystroke
    // parsing component wrapping them) — regular fill() works fine here.
    async fillPolicyId(value: string): Promise<void> {
        await this.elements.fill(this.policyIdInput, value, 'Policy ID field');
    };

    async fillCardId(value: string): Promise<void> {
        await this.elements.fill(this.cardIdInput, value, 'Card ID field');
    };

    // PrimeNG dropdown: click the combobox to open the overlay (appended to
    // <body>, so the option list isn't nested under the dropdown in the DOM),
    // then click the option by its accessible role — confirmed against the
    // real Gender dropdown's markup (<li role="option" aria-label="MALE">).
    // exact:true matters here specifically because it's case-sensitive AND
    // because option text can be a substring of another option's (MALE/FEMALE).
    // Shared by every p-dropdown on this form (currency, gender, participation, ...).
    private async selectDropdownOption(dropdown: Locator, optionText: string, description: string): Promise<void> {
        await this.elements.click(dropdown, description);
        await this.elements.click(
            this.page.getByRole('option', { name: optionText, exact: true }),
            `"${optionText}" option`
        );
    };

    async selectClaimCurrency(currencyCode: string): Promise<void> {
        await this.selectDropdownOption(this.claimCurrencyDropdown, currencyCode, 'Claim currency dropdown');
    };

    async fillClaimControlRequiredFields(receivedDate: string, capturedDate: string, currencyCode: string): Promise<void> {
        await this.fillReceivedDate(receivedDate);
        await this.fillCapturedDate(capturedDate);
        await this.selectClaimCurrency(currencyCode);
    };

    async fillClaimOverviewRequiredFields(
        accountDate: string,
        policyId: string,
        cardId: string,
        policyStart: string,
        policyEnd: string
    ): Promise<void> {
        await this.fillAccountDate(accountDate);
        await this.fillPolicyId(policyId);
        await this.fillCardId(cardId);
        await this.fillPolicyStart(policyStart);
        await this.fillPolicyEnd(policyEnd);
    };

    // Clicking "Add Plan" reveals an inline "Plan Editor" fieldset (Product Id,
    // Plan Code*, Plan Name, Contract Start*, Contract End*); its own "Add"
    // button then confirms the row into the Plans table below.
    async addPlan(productId: string, planCode: string, planName: string, contractStart: string, contractEnd: string): Promise<void> {
        await this.elements.click(this.addPlanButton, 'Add Plan button');

        await this.elements.fill(this.planProductIdInput, productId, 'Plan Product ID field');
        await this.elements.fill(this.planCodeInput, planCode, 'Plan Code field');
        await this.elements.fill(this.planNameInput, planName, 'Plan Name field');
        await this.fillCalendarField(this.planContractStartInput, contractStart, 'Plan contract start field');
        await this.fillCalendarField(this.planContractEndInput, contractEnd, 'Plan contract end field');

        await this.elements.click(this.confirmAddPlanButton, 'Confirm add plan button');
    };

    // Clicking "Add Member" reveals an inline "Member Editor" fieldset. Required:
    // Entity No, First Name, Surname, Date of Birth, Gender, National ID,
    // Participation, Dependent No, Terminate Date. The rest are optional and
    // only filled if provided. Same "Add" confirm-button pattern as addPlan().
    async addMember(member: CoveredMemberInput): Promise<void> {
        await this.elements.click(this.addMemberButton, 'Add Member button');

        await this.elements.fill(this.memberEntityNoInput, member.entityNo, 'Member Entity No field');
        await this.elements.fill(this.memberFirstNameInput, member.firstName, 'Member First Name field');
        await this.elements.fill(this.memberSurnameInput, member.surname, 'Member Surname field');
        await this.fillCalendarField(this.memberDateOfBirthInput, member.dateOfBirth, 'Member Date of Birth field');
        await this.selectDropdownOption(this.memberGenderDropdown, member.gender, 'Member Gender dropdown');
        await this.elements.fill(this.memberNationalIdInput, member.nationalIdentificationNumber, 'Member National Identification Number field');
        await this.selectDropdownOption(this.memberParticipationDropdown, member.participation, 'Member Participation dropdown');
        await this.elements.fill(this.memberDepNoInput, member.depNo, 'Member Dependent No field');
        await this.fillCalendarField(this.memberTerminateDateInput, member.terminateDate, 'Member Terminate Date field');

        if (member.dateOfDeath) {
            await this.fillCalendarField(this.memberDateOfDeathInput, member.dateOfDeath, 'Member Date of Death field');
        }
        if (member.identifier) {
            await this.elements.fill(this.memberIdentifierInput, member.identifier, 'Member Identifier field');
        }
        if (member.initials) {
            await this.selectDropdownOption(this.memberInitialsDropdown, member.initials, 'Member Initials dropdown');
        }
        if (member.joinDate) {
            await this.fillCalendarField(this.memberJoinDateInput, member.joinDate, 'Member Join Date field');
        }
        if (member.memberStatus) {
            await this.elements.fill(this.memberStatusInput, member.memberStatus, 'Member Status field');
        }
        if (member.yearsOfMembership) {
            await this.elements.fill(this.memberYearsOfMembershipInput, member.yearsOfMembership, 'Member Years of Membership field');
        }
        if (member.markAsPatient) {
            await this.elements.click(this.memberIsPatientCheckbox, 'Marked As Patient checkbox');
        }
        if (member.membersPhilHealth) {
            await this.selectDropdownOption(this.memberPhilHealthDropdown, member.membersPhilHealth, 'Members PhilHealth dropdown');
        }

        await this.elements.click(this.confirmAddMemberButton, 'Confirm add member button');
    };

    // Clicking "Add Provider" reveals an inline "Provider Editor" fieldset.
    // Only Provider Id/Provider Name are required — "Provider Role" already
    // defaults to "BILLING" and is valid as-is. p-inputnumber fields use
    // pressSequentially() rather than fill(), on the same reasoning as
    // p-calendar: PrimeNG's InputNumber has its own per-keystroke formatting,
    // so a bulk fill() risks not registering the same way the calendar didn't.
    async addProvider(provider: CoveredProviderInput): Promise<void> {
        await this.elements.click(this.addProviderButton, 'Add Provider button');

        await this.elements.fill(this.providerIdInput, provider.providerId, 'Provider Id field');
        await this.elements.fill(this.providerNameInput, provider.providerName, 'Provider Name field');

        if (provider.providerFlag) {
            await this.selectDropdownOption(this.providerFlagInput, provider.providerFlag,'dropdown');
        }
        if (provider.billingGracePeriod) {
            await this.elements.pressSequentially(this.billingGracePeriodInput, provider.billingGracePeriod, 'Billing Grace Period field');
        }
        if (provider.loaEndorsement) {
            await this.elements.fill(this.loaEndorsementInput, provider.loaEndorsement, 'Loa Endorsement field');
        }
        if (provider.vatPercentage) {
            await this.elements.fill(this.vatPercentageInput, provider.vatPercentage, 'VAT percentage field');
        }
        if (provider.withholdingTax) {
            await this.elements.pressSequentially(this.withholdingTaxInput, provider.withholdingTax, 'Withholding tax field');
        }
        if (provider.discountTAT) {
            await this.elements.fill(this.discountTATInput, provider.discountTAT, 'Discount TAT field');
        }
        if (provider.preApprovedLimit) {
            await this.elements.pressSequentially(this.preApprovedLimitInput, provider.preApprovedLimit, 'Pre-approved limit field');
        }
        if (provider.promptPaymentType) {
            await this.elements.fill(this.promptPaymentTypeInput, provider.promptPaymentType, 'Prompt payment type field');
        }
        if (provider.providerDiscountPercentage) {
            await this.elements.pressSequentially(this.providerDiscountPercentageInput, provider.providerDiscountPercentage, 'Provider discount percentage field');
        }

        await this.elements.click(this.confirmAddProviderButton, 'Confirm add provider button');
    };

    // Fills the first row whose Amount Type is still unset — Claim Overview
    // arrives with one such empty row — or, if every row is already filled,
    // adds a new one first. Call it once per amount.
    //
    // "Unset" = PrimeNG's p-dropdown-label-empty class on the combobox. After
    // clicking "Add amount" no extra wait is needed: the fill below auto-waits
    // until an empty row exists, so it can't land on a row filled earlier.
    // Amount is filled BEFORE the type on purpose: selecting the type is what
    // makes the row stop matching `emptyRow`, so it has to be the last action
    // performed through that locator.
    async addHeaderFinancialAmount(amountType: string, amount: string): Promise<void> {
        const emptyRow = this.headerFinancialAmountsSection
            .locator('tbody tr')
            .filter({ has: this.page.locator('p-dropdown[formcontrolname="financialAmountType"] .p-dropdown-label-empty') })
            .first();

        if (!(await this.elements.isVisible(emptyRow, 'empty header financial amount row'))) {
            await this.elements.click(this.addHeaderFinancialAmountButton, 'Header Financial Amounts Add amount button');
        }

        await this.fillNumberField(
            emptyRow.locator('p-inputnumber[formcontrolname="amount"] input'),
            amount,
            'Header Financial Amount field'
        );
        await this.selectDropdownOption(
            emptyRow.locator('p-dropdown[formcontrolname="financialAmountType"] [role="combobox"]'),
            amountType,
            'Header Financial Amount Type dropdown'
        );
    };

    // A single description textarea is already rendered on arrival — no need
    // to click "Add Description" first (that button adds further entries).
    async fillDiagnosisDescription(description: string): Promise<void> {
        await this.elements.fill(this.diagnosisDescriptionInput, description, 'Diagnosis Description field');
    };

    // p-inputnumber, same per-keystroke reasoning as addProvider(). Cleared
    // first because some of these arrive pre-filled (Quantity defaults to 1) —
    // pressSequentially() types at the cursor, so "1" + "2" would give "12".
    private async fillNumberField(input: Locator, value: string, description: string): Promise<void> {
        await input.clear();
        await this.elements.pressSequentially(input, value, description);
    };

    // A fresh line arrives with one empty Care Team row and one empty Financial
    // Amount row already rendered — the add buttons are only a fallback, in
    // case a line is ever created without them.
    private async ensureFirstRow(section: Locator, addButton: Locator, description: string): Promise<Locator> {
        const firstRow = section.locator('tbody tr').first();
        if (!(await this.elements.isVisible(firstRow, `first ${description} row`))) {
            await this.elements.click(addButton, `Add ${description} button`);
        }
        return firstRow;
    };

    // Fills the currently selected claim line (Line 1 on arrival).
    async fillClaimLine(line: ClaimLineInput): Promise<void> {
        await this.fillCalendarField(this.dateOfServiceInput, line.dateOfService, 'Date Of Service field');

        if (line.treatmentStartDate) {
            await this.fillCalendarField(this.treatmentStartDateInput, line.treatmentStartDate, 'Treatment Start Date field');
        }
        if (line.treatmentEndDate) {
            await this.fillCalendarField(this.treatmentEndDateInput, line.treatmentEndDate, 'Treatment End Date field');
        }
        if (line.quantity) {
            await this.fillNumberField(this.quantityInput, line.quantity, 'Quantity field');
        }
        if (line.originalDescription) {
            await this.elements.fill(this.originalDescriptionInput, line.originalDescription, 'Original Description field');
        }

        // Role already defaults to "TREATING"; Provider id/name are the required pair.
        const careTeamRow = await this.ensureFirstRow(this.careTeamSection, this.addCareTeamMemberButton, 'care team member');
        await this.elements.fill(careTeamRow.locator('input[formcontrolname="providerId"]'), line.careTeamProviderId, 'Care Team Provider id field');
        await this.elements.fill(careTeamRow.locator('input[formcontrolname="providerName"]'), line.careTeamProviderName, 'Care Team Provider name field');

        // Currency is display-only text in this row, taken from the claim currency.
        const amountRow = await this.ensureFirstRow(this.financialAmountsSection, this.addFinancialAmountButton, 'financial amount');
        await this.selectDropdownOption(
            amountRow.locator('p-dropdown[formcontrolname="financialAmountType"] [role="combobox"]'),
            line.financialAmountType,
            'Financial Amount Type dropdown'
        );
        await this.fillNumberField(amountRow.locator('p-inputnumber[formcontrolname="amount"] input'), line.financialAmount, 'Financial Amount field');
    };

    // Exact match on the card's own title — "Line 1" is a substring of "Line 10".
    getLineCard(lineNumber: number): Locator {
        return this.lineCards.filter({
            has: this.page.locator('.cc-line-card-title strong', { hasText: new RegExp(`^\\s*Line ${lineNumber}\\s*$`) }),
        });
    };

    // Waits on the editor's own "Line N" heading, not just the card click, so
    // the fill that follows can't land on the previously shown line.
    async selectItemLine(lineNumber: number): Promise<void> {
        await this.elements.click(this.getLineCard(lineNumber), `"Line ${lineNumber}" item card`);
        await this.elementAssert.toBeVisible(
            this.activeClaimLine.getByRole('heading', { name: `Line ${lineNumber}`, exact: true }),
            `"Line ${lineNumber}" item editor`
        );
    };

    // Adds a new line after the existing ones and fills it. The new line's
    // number is read from the last card *before* clicking Add Item — reading it
    // after would race the new card's render and could return the old last
    // line. The new card is then selected explicitly rather than relying on
    // Add Item auto-selecting it (not confirmed against the live app).
    // Line 1 already exists on arrival — fill that one with fillClaimLine().
    async addItem(line: ClaimLineInput): Promise<void> {
        // const lastLineTitle = await this.elements.getText(
        //     this.lineCards.last().locator('.cc-line-card-title strong'),
        //     'last item card title'
        // );
        // const newLineNumber = Number(lastLineTitle.replace(/\D/g, '')) + 1;

        await this.elements.click(this.addItemButton, 'Add Item button');
        // await this.page.pause()
        // await this.selectItemLine(newLineNumber);
        await this.fillClaimLine(line);
    };

    // Adds one treatment code to the currently selected item line, e.g.
    // "63963009". Opens Edit Treatment, searches, clicks the result row's "+"
    // action, waits for the code to land in the selected-codes table, then
    // Update. Call once per code.
    //
    // Results are matched on an exact Code cell, so a search that returns
    // several codes sharing a prefix still picks the right one; the click also
    // auto-waits for the (async) search results to arrive. Waiting for the
    // dialog to close at the end means the next action can't race its exit.
    async addTreatmentCode(code: string): Promise<void> {
        await this.elements.click(this.editTreatmentButton, 'Edit Treatment button');
        await this.elementAssert.toBeVisible(this.treatmentDialog, 'Edit Treatment dialog');

        await this.elements.fill(this.treatmentSearchInput, code, 'Treatment code search field');
        await this.treatmentSearchInput.press('Enter');

        const resultRow = this.treatmentSearchResultsTable
            .locator('tbody tr')
            .filter({ has: this.page.getByRole('cell', { name: code, exact: true }) });
        await this.elements.click(
            resultRow.locator('td').last().locator('div.cursor-pointer'),
            `add treatment code "${code}" action`
        );

        await this.elementAssert.toBeVisible(
            this.selectedTreatmentCodesTable.getByRole('cell', { name: code, exact: true }),
            `selected treatment code "${code}"`
        );

        await this.elements.click(this.treatmentDialogUpdateButton, 'Edit Treatment Update button');
        await this.elementAssert.toBeHidden(this.treatmentDialog, 'Edit Treatment dialog');
    };

    async clickNext(): Promise<void> {
        await this.elements.click(this.nextButton, 'Next button');
    };

    // Persists the in-progress claim as a draft (listed on the Claims Capture
    // drafts page) without submitting it. Available from any section — it's
    // in the top bar, not the section footer.
    async saveDraft(): Promise<void> {
        await this.elements.click(this.saveDraftButton, 'Save Draft button');
    };

    // ─── Assertions ───────────────────────────

    async expectClaimCaptureFormVisible(): Promise<void> {
        await this.elementAssert.toBeVisible(this.pageHeading, 'Claim capture heading');
    };

    // Doubles as the check that clickNext() from Claim Overview actually
    // advanced — Claim Overview's own validation would otherwise keep the
    // journey on section 2 and the next fill would fail far from the cause.
    async expectDischargeSummaryVisible(): Promise<void> {
        await this.elementAssert.toBeVisible(this.originalDiagnosisHeading, 'Original Diagnosis Description heading');
        await this.elementAssert.toBeVisible(this.diagnosisDescriptionInput, 'Diagnosis Description field');
        await this.elementAssert.toBeVisible(this.diagnosisHeading, 'Diagnosis heading');
    };

    // Same double duty as expectDischargeSummaryVisible(): proves the Next
    // from Discharge Summary actually advanced.
    async expectItemsVisible(): Promise<void> {
        await this.elementAssert.toBeVisible(this.itemsHeading, 'Items heading');
        await this.elementAssert.toBeVisible(this.dateOfServiceInput, 'Date Of Service field');
    };

    // Also proves the Next from Items advanced. Checks each section summary is
    // present — their label/value pairs are left alone until the labels are
    // confirmed (they were masked in the captured DOM).
    async expectReviewVisible(): Promise<void> {
        await this.elementAssert.toBeVisible(this.reviewHeading, 'Review heading');

        for (const section of ['Claim Control', 'Claim Overview', 'Discharge Summary', 'Items']) {
            await this.elementAssert.toBeVisible(
                this.reviewSection.getByRole('heading', { name: section, exact: true }),
                `Review "${section}" summary heading`
            );
        }
    };

    // Compares the panel's text against '' rather than asserting it hidden, so
    // a failure prints every outstanding validation message in the diff
    // instead of just "expected hidden". The panel renders with the rest of
    // the Review section, which expectReviewVisible() has already waited for.
    async expectNoBlockingValidations(): Promise<void> {
        const hasBlockingValidations = await this.elements.isVisible(this.blockingValidationsPanel, 'blocking validations panel');
        const messages = hasBlockingValidations
            ? await this.elements.getText(this.blockingValidationsList, 'blocking validations list')
            : '';

        await this.assert.toEqual(messages.trim(), '', 'blocking validations on Review');
    };

    // .first(): if Save Draft is clicked twice in quick succession, two toasts
    // can be on screen at once.
    async expectDraftSaved(): Promise<void> {
        await this.elementAssert.toBeVisible(this.draftSavedToast.first(), 'draft saved toast');
    };

    async expectSubmitClaimEnabled(): Promise<void> {
        await this.elementAssert.toBeEnabled(this.submitClaimButton, 'Submit Claim button');
    };
};
