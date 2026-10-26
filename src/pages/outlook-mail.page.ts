import type { Page, Locator } from "@playwright/test";
import { BasePage } from "@base/base.page.ts";
import { uiEndPoints } from "@constants/endpoint.config.ts";

export class OutlookMailPage extends BasePage {

    protected readonly newMailButton: Locator;

    constructor(page: Page) {
        super(page);    // Passes page up to BasePage

        // Only rendered once Outlook has actually signed the user in — the
        // Microsoft sign-in page has no equivalent, so it proves "authenticated"
        // rather than just "not on a login URL". Newer Outlook labels it
        // "New email"; .first() because the split button repeats the label.
        this.newMailButton = this.page.getByRole('button', { name: /^New (mail|email)/i }).first();
    };

    // ─── Actions ──────────────────────────────

    async open(): Promise<void> {
        await this.navigate(uiEndPoints.outlookMail);
    };

    // ─── Assertions ───────────────────────────

    async expectMailboxVisible(): Promise<void> {
        // Outlook's first paint is slow — well beyond the 10s expect default.
        await this.elementAssert.toBeVisible(this.newMailButton, 'Outlook New mail button', { timeout: 45_000 });
    };
};
