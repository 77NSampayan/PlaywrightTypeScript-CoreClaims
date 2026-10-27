// ─────────────────────────────────────────────
//  auth.setup.ts
//  Runs before the `api` and `msedge` projects (their `dependencies` in
//  playwright.config.ts) and leaves every test account with a working saved
//  session at storageStateFor(index). Every test in those projects starts
//  from its worker's file, already signed in — so the Core Claims portal and
//  the Azure Portal both skip the password and OTP.
//
//  Signs in at Microsoft directly (uiEndPoints.microsoftSignIn), not through
//  the portal: what the specs need from the file is Microsoft's SSO cookie.
//  The portal still gets its own token at the start of each spec
//  (signInIfPrompted), silently, from that cookie.
//
//  Per account:
//    - saved session exists → open Microsoft sign-in with it. If Microsoft
//      signs it in without asking, re-save it and stop: no password, no OTP.
//    - no saved session, or Microsoft rejected it → full sign-in with
//      password + generated TOTP, then save.
//  Validity is checked against Microsoft itself, never guessed from the
//  file's age.
//
//  Skip this project entirely (sessions must already exist and be valid):
//    npx playwright test --project=msedge --no-deps
// ─────────────────────────────────────────────

import fs from 'fs';
import { test as setup } from '@fixtures/base.fixture.ts';
import { test_accounts } from '@root/playwright.config.ts';
import { storageStateFor } from '@constants/environment.config.ts';

// How long Microsoft gets to sign a saved session in before it counts as
// rejected — covers the silent bounce through office.com and on to Microsoft 365.
const SAVED_SESSION_CHECK_TIMEOUT = 20_000;

for (const [index, account] of test_accounts.entries()) {
    // Own describe per account, so the storageState below applies to this account only.
    setup.describe(() => {
        // Evaluated when the worker loads this file — at the start of every run,
        // UI mode included.
        const hasSavedSession = fs.existsSync(storageStateFor(index));

        // Start from the saved session if there is one; otherwise signed out
        // (the fixture's default would load this very file, which doesn't exist yet).
        setup.use({ storageState: hasSavedSession ? storageStateFor(index) : { cookies: [], origins: [] } });

        // Slot number in the title, never the username — titles are published to the report.
        setup(`Signs in account #${index + 1} via Microsoft SSO (or reuses its valid saved session)`, async ({ microsoftLoginPage, logger }) => {
            // Full SSO round-trip, MFA included, plus the saved-session check before it.
            setup.setTimeout(150_000);

            if (hasSavedSession) {
                let sessionStillValid = false;

                // Microsoft completes the sign-in on its own only if it still accepts
                // the saved SSO cookie — otherwise it stops on its sign-in page.
                await logger.step('VALIDATE_SAVED_SESSION', async () => {
                    await microsoftLoginPage.open();
                    sessionStillValid = await microsoftLoginPage.isSignedInSilently(SAVED_SESSION_CHECK_TIMEOUT);
                });

                if (sessionStillValid) {
                    // Re-saved, not just kept: picks up any cookies Microsoft rotated
                    // during the check.
                    await logger.step('REFRESH_SAVED_SESSION', async () => {
                        await microsoftLoginPage.saveStorageState({ path: storageStateFor(index), indexedDB: true });
                    });
                    return;
                }

                await logger.step('DISCARD_REJECTED_SESSION', async () => {
                    logger.info(`Saved session for account #${index + 1} was rejected — signing in again.`);
                    await microsoftLoginPage.clearCookies();
                });
            }

            await logger.step('OPEN_MICROSOFT_SIGN_IN', async () => {
                await microsoftLoginPage.open();
            });

            await logger.step('SIGN_IN_VIA_MICROSOFT_SSO', async () => {
                await microsoftLoginPage.login(account.username, account.password, account.otpSecret);
                await microsoftLoginPage.expectRedirectedBackToApp();
            });

            await logger.step('VERIFY_SIGNED_IN', async () => {
                // The cookie that lets Microsoft skip the password and OTP for every
                // other app — fail here, not in some later spec, if it's missing.
                await microsoftLoginPage.expectSessionCookiePresent();
            });

            await logger.step('SAVE_SESSION', async () => {
                await microsoftLoginPage.saveStorageState({ path: storageStateFor(index), indexedDB: true });
            });
        });
    });
}
