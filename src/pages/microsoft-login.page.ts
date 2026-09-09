import type { Page, Locator } from "@playwright/test";
import { BasePage } from "@base/base.page.ts";
import { generateTOTP } from "@utils/totp.util.ts";

export class MicrosoftLoginPage extends BasePage {

    protected readonly emailField: Locator;
    protected readonly nextButton: Locator;
    protected readonly passwordField: Locator;

    // Password sign-in and OTP verify both submit through this same button;
    // "Stay signed in?" needs its own locator since that screen has more
    // than one type="submit" element (Yes / No) to disambiguate between.
    protected readonly submitButton: Locator;
    protected readonly staySignedInYesButton: Locator;

    // MFA — only shown when the account has an authenticator app registered.
    protected readonly signInAnotherWayLink: Locator;
    protected readonly authenticatorOtpOption: Locator;
    protected readonly otpCodeField: Locator;

    constructor(page: Page) {
        super(page);    // Passes page up to BasePage

        this.emailField    = this.page.locator('input[type="email"]');
        this.nextButton    = this.page.getByRole('button', { name: 'Next' });
        this.passwordField = this.page.locator('input[type="password"]');
        this.submitButton  = this.page.locator('input[type="submit"]');
        this.staySignedInYesButton = this.page.locator('input[type="submit"][value="Yes"]');

        this.signInAnotherWayLink   = this.page.locator('a#signInAnotherWay');
        this.authenticatorOtpOption = this.page.locator('div[data-value="PhoneAppOTP"]');
        this.otpCodeField           = this.page.locator('#idTxtBx_SAOTCC_OTC');
    };

    // ─── Actions ──────────────────────────────

    async enterEmail(email: string): Promise<void> {
        await this.elements.fill(this.emailField, email, 'Microsoft email field', { mask: true });
        await this.elements.click(this.nextButton, 'Next button');
    };

    async enterPassword(password: string): Promise<void> {
        await this.elements.waitForVisible(this.passwordField, 'Microsoft password field');
        await this.elements.fill(this.passwordField, password, 'Microsoft password field', { mask: true });
        await this.elements.click(this.submitButton, 'Sign in button');
    };

    async enterAuthenticatorCode(email: string, otpSecret: string): Promise<void> {
        // Microsoft sometimes lands straight on the OTP field, and sometimes shows a
        // "pick a sign-in method" screen first — only detour through it when it appears.
        const methodPickerAppeared = await this.signInAnotherWayLink
            .waitFor({ state: 'visible', timeout: 2_000 })
            .then(() => true)
            .catch(() => false);

        if (methodPickerAppeared) {
            await this.elements.click(this.signInAnotherWayLink, 'Sign in another way link');
            await this.elements.click(this.authenticatorOtpOption, 'Authenticator app OTP option');
        }

        // MFA itself is not guaranteed to be challenged (trusted device, Conditional
        // Access) — if the OTP field never shows up, skip this step rather than hang
        // and fail on a wait that was never going to resolve.
        const otpFieldAppeared = await this.otpCodeField
            .waitFor({ state: 'visible', timeout: 5_000 })
            .then(() => true)
            .catch(() => false);

        if (!otpFieldAppeared) {
            this.logger.info('MFA was not challenged for this sign-in — skipping OTP entry.');
            return;
        }

        await this.elements.fill(this.otpCodeField, generateTOTP(otpSecret, email), 'Authenticator OTP field', { mask: true });
        await this.elements.click(this.submitButton, 'Verify button');
    };

    async dismissStaySignedInPrompt(): Promise<void> {
        // Only present intermittently — acknowledge it if it shows up, skip it otherwise.
        const promptAppeared = await this.staySignedInYesButton
            .waitFor({ state: 'visible', timeout: 5_000 })
            .then(() => true)
            .catch(() => false);

        if (promptAppeared) {
            await this.elements.click(this.staySignedInYesButton, 'Stay signed in - Yes button');
        }
    };

    async login(email: string, password: string, otpSecret: string): Promise<void> {
        await this.enterEmail(email);
        await this.enterPassword(password);
        await this.enterAuthenticatorCode(email, otpSecret);
        await this.dismissStaySignedInPrompt();
    };

    // ─── Assertions ───────────────────────────

    async expectRedirectedBackToApp(): Promise<void> {
        await this.waitForURL((url) => !url.hostname.includes('microsoftonline.com'));
    };
};
