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
        this.claimCurrencyDropdown = this.page.locator('#claim-validation-claimCurrency p-dropdown');

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
        this.memberGenderDropdown  = this.coveredMembersSection.locator('p-dropdown[formcontrolname="gender"]');
        this.memberNationalIdInput = this.coveredMembersSection.locator('input[formcontrolname="nationalIdentificationNumber"]');
        this.memberIdentifierInput = this.coveredMembersSection.locator('input[formcontrolname="identifier"]');
        this.memberInitialsDropdown = this.coveredMembersSection.locator('p-dropdown[formcontrolname="initials"]');
        this.memberParticipationDropdown = this.coveredMembersSection.locator('p-dropdown[formcontrolname="participation"]');
        this.memberDepNoInput      = this.coveredMembersSection.locator('input[formcontrolname="depNo"]');
        this.memberJoinDateInput   = this.coveredMembersSection.locator('p-calendar[formcontrolname="joinDate"] input');
        this.memberTerminateDateInput = this.coveredMembersSection.locator('p-calendar[formcontrolname="terminateDate"] input');
        // formgroupname="status" > formcontrolname="id" — scoped narrowly since
        // "id" alone would be far too generic a formcontrolname to search on.
        this.memberStatusInput    = this.coveredMembersSection.locator('fieldset[formgroupname="status"] input[formcontrolname="id"]');
        this.memberYearsOfMembershipInput = this.coveredMembersSection.locator('input[formcontrolname="yearsOfMembership"]');
        this.memberIsPatientCheckbox = this.coveredMembersSection.locator('p-checkbox[formcontrolname="isPatient"] .p-checkbox-box');
        this.memberPhilHealthDropdown = this.coveredMembersSection.locator('p-dropdown[formcontrolname="isMembersPhilHealth"]');
        this.confirmAddMemberButton = this.coveredMembersSection.getByRole('button', { name: 'Add', exact: true });

        this.nextButton        = this.page.getByRole('button', { name: 'Next' });
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

    // PrimeNG dropdown: click to open the overlay (appended to <body>, so the
    // option list isn't nested under the dropdown in the DOM), then click the
    // option by its accessible role — assumes standard combobox/listbox markup
    // (role="option" per the aria-haspopup="listbox" on the trigger); worth
    // confirming once this actually runs against the real dropdown. Shared by
    // every p-dropdown on this form (currency, gender, participation, ...).
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

    async clickNext(): Promise<void> {
        await this.elements.click(this.nextButton, 'Next button');
    };

    // ─── Assertions ───────────────────────────

    async expectClaimCaptureFormVisible(): Promise<void> {
        await this.elementAssert.toBeVisible(this.pageHeading, 'Claim capture heading');
    };
};
