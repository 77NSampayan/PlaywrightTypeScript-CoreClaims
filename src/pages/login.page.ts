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
        await this.elements.fill(this.emailField, email, 'email field', { mask: true });
        await this.elements.click(this.signInButton, 'sign in button');
    };

    async signInIfPrompted(email: string): Promise<void> {
        // With a saved session the portal may still ask: its own token can live
        // in sessionStorage, which a saved session cannot restore. Clicking
        // Sign in then bounces through Microsoft, which completes silently from
        // the saved SSO cookie — no password, no OTP.
        const prompted = await this.elements.waitForVisibleSoft(this.emailField, 'email field', { timeout: 5_000 });

        if (!prompted) {
            this.logger.info('Portal session restored — no sign-in prompt shown.');
            return;
        }

        await this.login(email);
    };

    // ─── Assertions ───────────────────────────

    async expectLoginPageVisible(): Promise<void> {
        await this.elementAssert.toBeVisible(this.pageHeading, 'Product Portal heading');
        await this.elementAssert.toBeVisible(this.emailField, 'email field');
        await this.elementAssert.toBeVisible(this.signInButton, 'sign in button');
    };
};
