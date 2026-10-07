// ─────────────────────────────────────────────
//  auth.verify-session.ts
//  SPIKE — step 2 of the session-reuse question (step 1 is auth.save-session.ts).
//
//  Loads the session saved by auth.save-session.ts into a fresh browser
//  context and checks whether it still lands authenticated. This is the
//  question that gates the whole strategy: storageState does NOT persist
//  sessionStorage, so if the portal keeps auth state there — or uses a
//  device-bound token — reuse cannot work and the WFH path is void.
//
//    PowerShell:  $env:VERIFY_SESSION='1'; npx playwright test tests/auth.verify-session.ts --project=chromium
//    cmd:         set VERIFY_SESSION=1 && npx playwright test tests/auth.verify-session.ts --project=chromium
//    bash:        VERIFY_SESSION=1 npx playwright test tests/auth.verify-session.ts --project=chromium
//
//  This is a SMOKE CHECK, not a real assertion. It proves "not bounced back
//  to a login screen", which is weaker than "the app authorised me". For a
//  go/no-go spike, watching the headed browser is the real verification; these
//  assertions just stop it passing silently when it clearly failed.
// ─────────────────────────────────────────────

import { existsSync } from 'fs';
import { test as verify, expect } from '@fixtures/base.fixture.ts';
import { STORAGE_STATE } from '@constants/environment.config.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';

verify('a saved session still authenticates', async ({ browser, logger }) => {
    verify.skip(!process.env.VERIFY_SESSION, 'Set VERIFY_SESSION=1 to run this manually.');

    if (!existsSync(STORAGE_STATE)) {
        throw new Error(
            `No saved session at ${STORAGE_STATE}. Run tests/auth.save-session.ts first (see its header).`,
        );
    }

    // The context is built here, not via verify.use(), so the file is only read
    // after the skip check above — otherwise a missing file would fail the test
    // even when it is meant to be skipped. A manually created context does not
    // inherit baseURL from the config, so it is passed explicitly.
    const context = await browser.newContext({
        storageState: STORAGE_STATE,
        ...(process.env.BASE_URL ? { baseURL: process.env.BASE_URL } : {}),
    });
    const page = await context.newPage();

    try {
        await logger.step('OPEN_PORTAL_WITH_SAVED_SESSION', async () => {
            await page.goto('/');
            await page.waitForLoadState('domcontentloaded');
        });

        await logger.step('CHECK_STILL_AUTHENTICATED', async () => {
            const landedOn = page.url();
            logger.highlight(`Landed on "${landedOn}"`);

            // Bounced to the portal's own login route → the session did not carry.
            expect(landedOn, 'session did not carry — redirected to the portal login page')
                .not.toContain(uiEndPoints.login);

            // Bounced to Microsoft → re-authentication was demanded.
            expect(landedOn, 'session did not carry — redirected to Microsoft SSO')
                .not.toContain('microsoftonline.com');

            logger.highlight('Session reuse WORKS — storageState is a viable strategy.');
        });
    } finally {
        await context.close();
    }
});
