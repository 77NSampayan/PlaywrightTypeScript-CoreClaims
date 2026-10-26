// ─────────────────────────────────────────────
//  test.auth.spec.ts
//  Session-reuse check: does a saved Microsoft SSO session let a fresh
//  browser context skip the Authenticator OTP?
//
//  Uses Outlook on the web as the target app — same Microsoft sign-in, same
//  MFA policy as the portal, so it answers the OTP question in isolation.
//  It does NOT prove the portal's own token storage survives a save — the
//  real suite's tests/auth.setup.ts and the specs that reuse it answer that.
//
//    1. Sign in to Outlook (password + generated TOTP), save the session.
//    2. Open Outlook in a brand-new context loaded from that file, with no
//       credentials at all — it must carry Microsoft's SSO cookie and land
//       straight in the mailbox.
//    3. Control: open Outlook in an EMPTY context — it must be asked to sign
//       in. Without this, step 2 passing could be Edge signing in on its own.
//
//  Gated by AUTH_SPIKE so a plain full run doesn't spend a live MFA sign-in:
//
//    PowerShell:  $env:AUTH_SPIKE='1'; npx playwright test --project=auth
//    bash:        AUTH_SPIKE=1 npx playwright test --project=auth
//    UI mode:     $env:AUTH_SPIKE='1'; npx playwright test --ui
//                 (the variable must be set before UI mode starts)
// ─────────────────────────────────────────────

import { test } from '@fixtures/base.fixture.ts';
import { OUTLOOK_STORAGE_STATE } from '@constants/environment.config.ts';

// Step 2 reads the file step 1 writes — run in order, and skip 2 if 1 fails.
test.describe.configure({ mode: 'serial' });

// A failure screenshot here would put a real mailbox in the report. Tracing
// is left to playwright.config.ts (local only, never CI) — forcing it off
// here also empties UI mode's Actions panel, which is built from the trace.
test.use({ screenshot: 'off' });

// Step 1 signs in itself: start signed out rather than from the fixture's
// default per-worker portal session (the `auth` project has no `setup` dependency).
test.use({ storageState: { cookies: [], origins: [] } });

test.skip(!process.env.AUTH_SPIKE, 'Set AUTH_SPIKE=1 to run the session-reuse check.');

test.describe('Session reuse - Outlook on the web', () => {

    test('Signs in with password and OTP, then saves the session', async ({ account, outlookMailPage, microsoftLoginPage, logger }) => {
        // Full SSO round-trip plus Outlook's slow first load.
        test.setTimeout(120_000);

        await logger.step('OPEN_OUTLOOK', async () => {
            await outlookMailPage.open();
        });

        await logger.step('COMPLETE_MICROSOFT_SIGN_IN', async () => {
            await microsoftLoginPage.login(
                account.username,
                account.password,
                account.otpSecret
            );
            await microsoftLoginPage.expectRedirectedBackToApp();
        });

        await logger.step('VERIFY_MAILBOX', async () => {
            await outlookMailPage.expectMailboxVisible();
        });

        await logger.step('SAVE_SESSION', async () => {
            // IndexedDB too: Outlook keeps some auth state there, and leaving it
            // out could fail step 2 for a reason unrelated to the OTP.
            await outlookMailPage.saveStorageState({ path: OUTLOOK_STORAGE_STATE, indexedDB: true });
        });
    });

    test.describe('with the saved session', () => {
        // Each test gets a brand-new context — this one starts from the file
        // above instead of empty, with no further sign-in performed.
        test.use({ storageState: OUTLOOK_STORAGE_STATE });

        test('Opens the mailbox without asking for the OTP', async ({ outlookMailPage, microsoftLoginPage, logger }) => {
            test.setTimeout(90_000);

            // Checked before any navigation, so the cookie can only have come
            // from the saved file — proves the file was actually loaded.
            await logger.step('VERIFY_SAVED_SESSION_LOADED', async () => {
                await microsoftLoginPage.expectSessionCookiePresent();
            });

            await logger.step('OPEN_OUTLOOK_WITH_SAVED_SESSION', async () => {
                await outlookMailPage.open();
            });

            // Nothing is typed in this test, so reaching the mailbox at all means
            // neither the password nor the OTP was asked for. If the session did
            // not carry, Microsoft's sign-in page waits for input and this fails.
            await logger.step('VERIFY_MAILBOX_WITHOUT_SIGN_IN', async () => {
                await outlookMailPage.expectMailboxVisible();
            });
        });
    });

    test.describe('without a saved session (control)', () => {
        // The other half of the proof. If a clean context ALSO reaches the
        // mailbox, something else is signing in (e.g. Edge's Windows-account
        // SSO) and the reuse test above proves nothing about the file.
        test.use({ storageState: { cookies: [], origins: [] } });

        test('Is asked to sign in, so the saved session is what skips it', async ({ outlookMailPage, microsoftLoginPage, logger }) => {
            test.setTimeout(60_000);

            await logger.step('OPEN_OUTLOOK_WITHOUT_SESSION', async () => {
                await outlookMailPage.open();
            });

            await logger.step('VERIFY_SIGN_IN_REQUIRED', async () => {
                await microsoftLoginPage.expectSignInPrompted();
            });
        });
    });
});
