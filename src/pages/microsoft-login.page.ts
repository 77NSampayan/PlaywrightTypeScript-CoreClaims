import type { Page, Locator } from "@playwright/test";
import { BasePage } from "@base/base.page.ts";
import { generateTOTP, msUntilNextTotpPeriod } from "@utils/totp.util.ts";
import { uiEndPoints } from "@constants/endpoint.config.ts";

// Signed-in means Microsoft has handed off to whatever app asked — the
// portal, Outlook, or Microsoft 365 when sign-in was opened directly.
const leftMicrosoftSignIn = (url: URL): boolean => !url.hostname.includes('microsoftonline.com');

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

    async open(): Promise<void> {
        // Microsoft's sign-in on its own, with no app in front of it.
        await this.navigate(uiEndPoints.microsoftSignIn);
    };

    async isSignedInSilently(timeout: number): Promise<boolean> {
        // Soft: false (not a failure) when a saved session is rejected — Microsoft
        // then stays on its sign-in page waiting for input instead of handing off.
        return this.waitForURLSoft(leftMicrosoftSignIn, 'redirect off Microsoft sign-in', { timeout });
    };

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

        const methodPickerAppeared = await this.elements.waitForVisibleSoft(this.signInAnotherWayLink, 'Sign in another way link', { timeout: 2_000 });

        if (methodPickerAppeared) {
            await this.elements.click(this.signInAnotherWayLink, 'Sign in another way link');
            await this.elements.click(this.authenticatorOtpOption, 'Authenticator app OTP option');
        }

        // MFA itself is not guaranteed to be challenged (trusted device, Conditional
        // Access) — if the OTP field never shows up, skip this step rather than hang
        // and fail on a wait that was never going to resolve.


        const otpFieldAppeared = await this.elements.waitForVisibleSoft(this.otpCodeField, 'Authenticator OTP field', { timeout: 5_000 });

        if (!otpFieldAppeared) {
            this.logger.info('MFA was not challenged for this sign-in — skipping OTP entry.');
            return;
        }

        await this.elements.fill(this.otpCodeField, generateTOTP(otpSecret, email), 'Authenticator OTP field', { mask: true });
        await this.elements.click(this.submitButton, 'Verify button');
    };

    async dismissStaySignedInPrompt(): Promise<void> {
        // Only present intermittently — acknowledge it if it shows up, skip it otherwise.

        const promptAppeared = await this.elements.waitForVisibleSoft(this.staySignedInYesButton, 'Stay signed in - Yes button', { timeout: 5_000 });

        if (promptAppeared) {
            await this.elements.click(this.staySignedInYesButton, 'Stay signed in - Yes button');
        }
    };

    async waitForFreshOtpCode(): Promise<void> {
        // A TOTP code is single-use: Microsoft rejects one already redeemed in
        // the same 30s window — e.g. by tests/auth.setup.ts signing in moments
        // before. Waiting for the next window guarantees an unused code. A hard
        // wait is deliberate: no page signal exists for "a new code is due".
        await this.waitForTimeout(msUntilNextTotpPeriod());
    };

    async login(email: string, password: string, otpSecret: string): Promise<void> {
        await this.enterEmail(email);
        await this.enterPassword(password);
        await this.enterAuthenticatorCode(email, otpSecret);
        await this.dismissStaySignedInPrompt();
    };

    // ─── Assertions ───────────────────────────

    async expectRedirectedBackToApp(): Promise<void> {
        await this.waitForURL(leftMicrosoftSignIn);
    };

    async expectSignInPrompted(): Promise<void> {
        await this.elementAssert.toBeVisible(this.emailField, 'Microsoft email field', { timeout: 30_000 });
    };

    async expectSessionCookiePresent(): Promise<void> {
        // ESTSAUTH / ESTSAUTHPERSISTENT are Microsoft's own SSO session cookies —
        // the ones that let it skip the password and OTP for an already
        // signed-in browser. Checked by name only; values are never read.
        const cookieNames = await this.getCookieNames(uiEndPoints.microsoftLogin);
        await this.assert.toBeTruthy(
            cookieNames.some((name) => name.startsWith('ESTSAUTH')),
            'Microsoft SSO session cookie (ESTSAUTH*) in this context'
        );
    };
};
