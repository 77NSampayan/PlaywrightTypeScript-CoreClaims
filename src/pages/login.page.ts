import type { Page, Locator } from "@playwright/test";
import { BasePage } from "@base/base.page.ts";

export class LoginPage extends BasePage {

    protected readonly pageHeading: Locator;
    protected readonly emailField: Locator;
    protected readonly signInButton: Locator;

    constructor(page: Page) {
        super(page);    // Passes page up to BasePage

        this.pageHeading  = this.page.getByRole('heading', { name: 'Product Portal' });
        this.emailField   = this.page.locator('#login_email');
        this.signInButton = this.page.locator('#login button[type="submit"]');
    };

    // ─── Actions ──────────────────────────────

    async login(email: string): Promise<void> {
        await this.elements.fill(this.emailField, email, 'email field');
        await this.elements.click(this.signInButton, 'sign in button');
    };

    // ─── Assertions ───────────────────────────

    async expectLoginPageVisible(): Promise<void> {
        await this.elementAssert.toBeVisible(this.pageHeading, 'Product Portal heading');
        await this.elementAssert.toBeVisible(this.emailField, 'email field');
        await this.elementAssert.toBeVisible(this.signInButton, 'sign in button');
    };
};
