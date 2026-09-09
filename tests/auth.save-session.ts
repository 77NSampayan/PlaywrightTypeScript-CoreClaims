// ─────────────────────────────────────────────
//  auth.save-session.ts
//  SPIKE — step 1 of the session-reuse question in AUTHENTICATION.md.
//
//  Opens a browser, waits for YOU to sign in by hand (including the
//  Authenticator push), then persists the resulting session to disk.
//
//  Run it explicitly — it pauses for a human, so it is skipped unless
//  SAVE_SESSION is set, otherwise a plain `npx playwright test` would hang:
//
//    PowerShell:  $env:SAVE_SESSION='1'; npx playwright test tests/auth.save-session.ts --project=chromium
//    cmd:         set SAVE_SESSION=1 && npx playwright test tests/auth.save-session.ts --project=chromium
//    bash:        SAVE_SESSION=1 npx playwright test tests/auth.save-session.ts --project=chromium
// ─────────────────────────────────────────────

import { test as save } from '@fixtures/base.fixture.ts';
import { STORAGE_STATE } from '@constants/environment.config.ts';

// Start from an empty context so the login flow actually runs, rather than
// inheriting a session from a previous save.
save.use({ storageState: { cookies: [], origins: [] } });

save('save an authenticated session for reuse', async ({ page, loginPage, logger }) => {
    save.skip(!process.env.SAVE_SESSION, 'Set SAVE_SESSION=1 to run this manually.');

    // A human has to read a push notification and tap Approve.
    save.setTimeout(10 * 60_000);

    await logger.step('OPEN_LOGIN_PAGE', async () => {
        await loginPage.navigate();
    });

    logger.highlight('─────────────────────────────────────────────');
    logger.highlight('Sign in BY HAND in the browser window that opened,');
    logger.highlight('including the Microsoft Authenticator prompt.');
    logger.highlight('Once you are on the portal, press Resume (▶) in the');
    logger.highlight('Playwright Inspector to persist the session.');
    logger.highlight('─────────────────────────────────────────────');

    // Opens the Inspector and blocks until you press Resume.
    // Requires headed mode — this project runs headed by default.
    await page.pause();

    await logger.step('PERSIST_SESSION_STATE', async () => {
        await page.context().storageState({ path: STORAGE_STATE });
        logger.highlight(`Session written to "${STORAGE_STATE}"`);
        logger.highlight('Now run tests/auth.verify-session.ts to confirm it is reusable.');
    });
});
