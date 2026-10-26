// ─────────────────────────────────────────────
//  SessionReuse.spec.ts
//  Proves a test in the `msedge` project starts from the session the `setup`
//  project (tests/auth.setup.ts) saved for its worker's account, and reaches
//  the portal WITHOUT signing in to Microsoft again.
//
//  No storageState override here, so the fixture default loads
//  storageStateFor(parallelIndex). `dependencies: ['setup']` holds this test
//  back until every account's session has been saved.
//
//  Only the account's email is read below — never its password or OTP secret —
//  so reaching the landing page at all means Microsoft did not ask for them.
// ─────────────────────────────────────────────

import { test, uiEndPoints } from '@fixtures/base.fixture.ts';

test.describe('Amplify Health Product Portal - Session reuse', () => {
    test('Opens the portal from the saved session without a Microsoft sign-in', async ({ account, loginPage, microsoftLoginPage, landingPage, logger }) => {
        // Checked before any navigation, so the cookie can only have come from
        // the saved file — proves setup's session was actually loaded.
        await logger.step('VERIFY_SAVED_SESSION_LOADED', async () => {
            await microsoftLoginPage.expectSessionCookiePresent();
        });

        await logger.step('OPEN_LANDING_PAGE', async () => {
            await landingPage.navigate(uiEndPoints.landing);
        });

        // The portal may still show its own email prompt (its token can live in
        // sessionStorage, which a saved session cannot restore). Submitting it
        // bounces through Microsoft, which must complete silently from the saved
        // SSO cookie. If Microsoft asked for a password, the steps below time
        // out on its sign-in page.
        await logger.step('CONTINUE_WITH_SAVED_SESSION', async () => {
            await loginPage.signInIfPrompted(account.username);
            await microsoftLoginPage.expectRedirectedBackToApp();
        });

        await logger.step('VERIFY_LANDING_PAGE_WITHOUT_SIGN_IN', async () => {
            await landingPage.expectLandingPageVisible();
            await landingPage.expectAppAvailable('Amplify Health Core Claims');
        });
    });
});
