import type { Page, Locator } from "@playwright/test";
import { BasePage } from "@base/base.page.ts";

export class ClaimsQueryPage extends BasePage {

    protected readonly pageHeading: Locator;
    protected readonly searchByDropdown: Locator;
    protected readonly keywordsInput: Locator;
    protected readonly resultsTable: Locator;
    protected readonly emptyResult: Locator;

    constructor(page: Page) {
        super(page);    // Passes page up to BasePage

        this.pageHeading = this.page.getByRole('heading', { name: 'Claims Query' });

        // PrimeNG dropdown, same pattern as claim-capture-form.page.ts's
        // currency/gender dropdowns — click the combobox to open the overlay
        // (appended to <body>), then click the option by role. No stable
        // formcontrolname confirmed yet — scoped as the first dropdown on the
        // page, which is this "search by" field.
        this.searchByDropdown = this.page.locator('p-dropdown [role="combobox"]').first();
        this.keywordsInput    = this.page.getByPlaceholder('Keywords');
        this.resultsTable     = this.page.locator('p-table table');
        // The "No results found" row the table renders when a search matches
        // nothing — the app's own empty-state component, not its hashed classes.
        this.emptyResult      = this.resultsTable.locator('lib-empty-result');
    };

    // ─── Actions ──────────────────────────────

    private async selectSearchBy(fieldName: string): Promise<void> {
        await this.elements.click(this.searchByDropdown, 'Search by dropdown');
        await this.elements.click(
            this.page.getByRole('option', { name: fieldName, exact: true }),
            `"${fieldName}" option`
        );
    };

    // Same raw .press('Enter') as ClaimsCapturePage.searchDrafts() — the
    // search field only filters on Enter, not on type.
    async searchByControlCode(controlCode: string): Promise<void> {
        await this.selectSearchBy('Control Code');
        await this.elements.fill(this.keywordsInput, controlCode, 'Keywords search field');
        await this.keywordsInput.press('Enter');
    };

    // exact:true avoids "OPEML2026101900015T" also matching as a substring of
    // a longer control code — same reasoning as ClaimsCapturePage.getDraftRow().
    getResultRowByControlCode(controlCode: string): Locator {
        return this.resultsTable
            .getByRole('row')
            .filter({ has: this.page.getByRole('cell', { name: controlCode, exact: true }) });
    };

    // ─── Assertions ───────────────────────────

    async expectClaimsQueryPageVisible(): Promise<void> {
        await this.toHaveURL(/\/customer-ui\/claims\/query/);
        await this.elementAssert.toBeVisible(this.pageHeading, 'Claims Query heading');
    };

    // A Control Code can legitimately match more than one row — one per claim
    // line in the uploaded intake file — so this only confirms at least one
    // match is visible rather than asserting on the (possibly multi-element)
    // locator directly, which toBeVisible() rejects under Playwright's strict
    // mode ("resolved to N elements").
    async expectControlCodeFound(controlCode: string): Promise<void> {
        await this.elementAssert.toBeVisible(
            this.getResultRowByControlCode(controlCode).first(),
            `claim row for Control Code "${controlCode}"`
        );
    };

    // Asserts the exact number of rows for a Control Code — e.g. a hand-edited
    // intake file with 2 rows sharing one Control Code should surface exactly
    // 2 claims here. expectControlCodeFound() runs first so the results table
    // has actually re-rendered after the search before count() is read —
    // GenericAssertions.toEqual() does not auto-retry (see its own doc
    // comment), so the wait has to happen before it, not as part of it.
    async expectControlCodeCount(controlCode: string, expectedCount: number): Promise<void> {
        await this.expectControlCodeFound(controlCode);

        const actualCount = await this.getResultRowByControlCode(controlCode).count();
        await this.assert.toEqual(actualCount, expectedCount, `number of claim rows for Control Code "${controlCode}"`);
    };

    // For a Control Code DE has processed but never assigned a
    // medicard_bill_code — correctly should NOT surface here. Waits for the
    // table's "No results found" state first: toBeHidden() alone passes on a
    // locator matching zero elements, i.e. before the search results have
    // even rendered, so it could miss a row that shows up a moment later.
    async expectControlCodeNotFound(controlCode: string): Promise<void> {
        await this.elementAssert.toBeVisible(this.emptyResult, `"No results found" for Control Code "${controlCode}"`);
        await this.elementAssert.toBeHidden(
            this.getResultRowByControlCode(controlCode).first(),
            `claim row for Control Code "${controlCode}"`
        );
    };
};
