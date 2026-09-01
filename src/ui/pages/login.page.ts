import type { Page, Locator } from "@playwright/test";
import { BasePage } from "../base/base.page.ts";

export class LoginPage extends BasePage {

    protected readonly usernameField: Locator;
    protected readonly passwordField: Locator;
    protected readonly submitButton: Locator;
    protected readonly flashMessage: Locator;

    constructor(page: Page) {
        super(page);    // Passes page up to BasePage

        this.usernameField = this.page.locator('#username');
        this.passwordField = this.page.locator('#password');
        this.submitButton  = this.page.locator('button[type="submit"]');
        this.flashMessage  = this.page.locator('#flash');
    };

    // ─── Actions ──────────────────────────────

    async login(username: string, password: string): Promise<void> {
        await this.elements.fill(this.usernameField, username, 'username field');
        await this.elements.fill(this.passwordField, password, 'password field');
        await this.elements.click(this.submitButton, 'submit button');
    }

    // ─── Assertions ───────────────────────────

    async expectLoginSuccess(): Promise<void> {
        await this.elementAssert.toBeVisible(this.flashMessage, 'flash message');
        await this.elementAssert.toContainText(this.flashMessage, 'You logged into a secure area!', 'flash message');
        await this.toHaveURL("/secure")
    }
}
