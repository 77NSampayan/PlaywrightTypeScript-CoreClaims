import type { Page, Locator } from "@playwright/test";
import { BasePage } from "@base/base.page.ts";
import { ClaimCaptureFormPage } from "@pages/claim-capture-form.page.ts";

export class ClaimsCapturePage extends BasePage {

    protected readonly pageHeading: Locator;
    protected readonly createClaimButton: Locator;
    protected readonly searchInput: Locator;
    protected readonly draftsTable: Locator;

    constructor(page: Page) {
        super(page);    // Passes page up to BasePage

        this.pageHeading       = this.page.getByRole('heading', { name: 'Claim capture drafts' });
        this.createClaimButton = this.page.locator('button[label="Create Claim"]');
        this.searchInput       = this.page.locator('input[placeholder^="Search policy"]');
        this.draftsTable       = this.page.locator('p-table table');
    };

    // ─── Actions ──────────────────────────────

    // Same-tab Angular route change (a <button>, not an <a target=_blank>), and
    // deterministically leads to exactly one page — so unlike LandingPage.clickApp()
    // (which can launch any of several unrelated apps), returning the specific
    // page object here is the natural fluent-navigation shape.
    async clickCreateClaim(): Promise<ClaimCaptureFormPage> {
        await this.elements.click(this.createClaimButton, 'Create Claim button');

        const claimCaptureFormPage = new ClaimCaptureFormPage(this.page);
        await claimCaptureFormPage.expectClaimCaptureFormVisible();
        return claimCaptureFormPage;
    };

    async searchDrafts(query: string): Promise<void> {
        await this.elements.fill(this.searchInput, query, 'drafts search field');
        await this.searchInput.press('Enter');
    };

    // hasText does substring matching, which would make draft id "1" also match
    // "15" — getByRole('cell', { exact: true }) avoids that the same way the
    // landing page app cards needed exact matching over hasText.
    getDraftRow(draftId: string): Locator {
        return this.draftsTable
            .getByRole('row')
            .filter({ has: this.page.getByRole('cell', { name: draftId, exact: true }) });
    };

    async clickEditDraft(draftId: string): Promise<void> {
        const row = this.getDraftRow(draftId);
        await this.elements.click(row.getByRole('button', { name: 'Edit' }), `Edit button for draft "${draftId}"`);
    };

    async clickRemoveDraft(draftId: string): Promise<void> {
        const row = this.getDraftRow(draftId);
        await this.elements.click(row.getByRole('button', { name: 'Remove' }), `Remove button for draft "${draftId}"`);
    };

    // ─── Assertions ───────────────────────────

    async expectClaimsCapturePageVisible(): Promise<void> {
        await this.toHaveURL(/\/customer-ui\/claims\/capture-v2/);
        await this.elementAssert.toBeVisible(this.pageHeading, 'Claim capture drafts heading');
        await this.elementAssert.toBeVisible(this.createClaimButton, 'Create Claim button');
        await this.elementAssert.toBeVisible(this.searchInput, 'drafts search field');
    };

    async expectDraftVisible(draftId: string): Promise<void> {
        await this.elementAssert.toBeVisible(this.getDraftRow(draftId), `draft row "${draftId}"`);
    };
};
