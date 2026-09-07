import type { Page, Locator } from "@playwright/test";
import { BasePage } from "@base/base.page.ts";

export class MicrosoftLoginPage extends BasePage {

    protected readonly emailField: Locator;
    protected readonly passwordField: Locator;

    // Microsoft reuses this same id for the "Next", "Sign in" and "Yes"
    // (stay signed in?) buttons across each step of the flow.
    protected readonly primaryButton: Locator;

    constructor(page: Page) {
        super(page);    // Passes page up to BasePage

        this.emailField    = this.page.locator('input[name="loginfmt"]');
        this.passwordField = this.page.locator('input[name="passwd"]');
        this.primaryButton = this.page.locator('#idSIButton9');
    };

    // ─── Actions ──────────────────────────────

    async enterEmail(email: string): Promise<void> {
        await this.elements.fill(this.emailField, email, 'Microsoft email field');
        await this.elements.click(this.primaryButton, 'Next button');
    };

    async enterPassword(password: string): Promise<void> {
        await this.elements.waitForVisible(this.passwordField, 'Microsoft password field');
        await this.elements.fill(this.passwordField, password, 'Microsoft password field');
        await this.elements.click(this.primaryButton, 'Sign in button');
    };

    async dismissStaySignedInPrompt(): Promise<void> {
        // Only present intermittently — acknowledge it if it shows up, skip it otherwise.
        const promptAppeared = await this.primaryButton
            .waitFor({ state: 'visible', timeout: 5_000 })
            .then(() => true)
            .catch(() => false);

        if (promptAppeared) {
            await this.elements.click(this.primaryButton, 'Stay signed in - Yes button');
        }
    };

    async login(email: string, password: string): Promise<void> {
        await this.enterEmail(email);
        await this.enterPassword(password);
        await this.dismissStaySignedInPrompt();
    };

    // ─── Assertions ───────────────────────────

    async expectRedirectedBackToApp(): Promise<void> {
        await this.waitForURL((url) => !url.hostname.includes('microsoftonline.com'));
    };
};
