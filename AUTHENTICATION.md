# Authentication strategy — automating Microsoft SSO with conditional MFA

**Status:** proposed — not yet implemented
**Supersedes:** `AUTOMATION_AUTH_README.md` (original research; strategy retained, code corrected)

---

## The problem

The Amplify Health Product Portal authenticates through Microsoft SSO. When
Microsoft Authenticator is challenged, it is a **push notification to a physical
device** — there is no secret Playwright can compute, so the second factor
cannot be automated. It has to be avoided or reused.

> **Update:** this holds for an account whose *only* registered method is the
> Authenticator push. The automation test account (`VALID_USERNAME_1`) has
> since had an authenticator app registered in **TOTP/code mode** instead
> (Security info → Add sign-in method → Authenticator app → "I can't scan the
> QR code" → save the one-time secret). With that registered, MFA resolves to
> a computable code — same technique as
> [eliostruyf.com's M365 login guide](https://www.eliostruyf.com/automating-microsoft-365-login-mfa-playwright-tests/)
> and its `playwright-m365-helpers` package — and is implemented directly in
> [`MicrosoftLoginPage.enterAuthenticatorCode()`](src/pages/microsoft-login.page.ts)
> using this repo's own page-object/logging conventions rather than that
> package. See `VALID_OTP_SECRET_1` in `.env` and `Login.spec.ts`.
>
> This is an option for accounts that have a TOTP method registered, not a
> replacement for the strategy below: it needs the secret captured once per
> account, and CA policy could still mandate push-only for other accounts.
> Session reuse remains the answer for anyone without a TOTP-registered
> account (e.g. WFH devices using a personal push-only account).

## The constraint that makes this solvable

MFA is not challenged unconditionally. From the original research:

1. Authenticator is triggered when logging in from a **non-project laptop**.
2. Authenticator is triggered when connecting from **outside the project network**.

So a **project laptop on the project network is not challenged.** That single
fact is what the whole strategy rests on.

> ⚠️ **This is a Conditional Access policy owned by IT, not a property of the
> app.** It can be tightened at any time without notice, and when it is, the
> automation stops working — on the project network it will suddenly sit waiting
> for a push nobody approves. Treat a sudden crop of login timeouts as "check
> whether CA policy changed" before assuming an app defect. The original
> document does not flag this, and it is the main long-term fragility.

---

## Options evaluated

| # | Option | Verdict |
|---|---|---|
| 1 | **Service account with MFA exemption** — IT creates a dedicated automation account with 2FA disabled or an IP-based CA exemption | ✅ **Correct long-term answer.** Needs IT/Entra admin coordination |
| 2 | **API / token-based auth** — bypass UI login via OAuth or an API key | ✅ Viable if the portal exposes one; needs admin cooperation. Does not help UI tests that must start authenticated |
| 3 | **Session reuse** — authenticate once, persist the session, replay it | ✅ **Chosen interim.** No IT involvement; works within existing CA rules |
| 4 | **Appium + Android emulator** — drive Authenticator itself | ❌ Rejected. Authenticator blocks emulators by design. Also true of [Mobilewright](https://github.com/mobile-next/mobilewright) despite its Playwright-like API — the blocker is Authenticator, not the tool |

**Options 1 and 3 are not alternatives.** Pursue 1 with IT in parallel; 3 is what
unblocks work today. When the service account arrives, `NETWORK_ENV` collapses to
a single path and most of this document is deleted.

---

## Decision

Branch the auth strategy on an environment flag, and persist the session with
Playwright's native `storageState` so **authentication happens once per run
rather than once per test.**

```
                    ┌─ NETWORK_ENV=project ─→ setup project logs in live (no MFA)
Playwright run ─────┤                          → writes playwright/.auth/session.json
                    └─ NETWORK_ENV=wfh ─────→ setup skipped; reuse a session.json
                                               saved manually beforehand
                                    │
                                    ▼
                       All browser projects start authenticated
                       via use: { storageState }
```

### Why once-per-run matters beyond speed

Right now every test performs a full real SSO login. That is the practical
ceiling on the suite: a negative-path suite of 15 tests × 3 browser projects
would mean 45 real authentications against a live account, which is slow, and
is exactly the pattern that trips conditional-access throttling and lockout.
Session reuse is what makes broader coverage possible at all.

---

## Corrections to the original implementation

The original code sketch was written for a generic Playwright project. Six
things would break or mislead here:

### 1. `process.env.USERNAME` is a Windows built-in — do not use it

Windows always sets `USERNAME` to the logged-in OS user. So
`fill(process.env.USERNAME)` **silently types the wrong value** instead of
failing with "missing environment variable". This repo's existing
`VALID_USERNAME_1` / `VALID_PASSWORD_1` names avoid the collision; keep them.

### 2. `addCookies()` loses half the session

```ts
// original — incomplete
await context.addCookies(require('../auth/session.json').cookies);
```

`storageState()` writes `{ cookies, origins }`, where `origins` carries
**localStorage**. MSAL and Microsoft SSO keep tokens there, so a cookie-only
restore will very likely fail to authenticate. Use the `storageState` option,
which restores both.

### 3. `require()` does not exist here

`package.json` sets `"type": "module"`. `require` is undefined — that line
throws. Use `storageState` by path and let Playwright read the file.

### 4. Framework conventions

The sketch imports `test` from `@playwright/test`, drives raw locators, and
hardcodes `/login`. In this repo that means: no page objects, no structured
logging, nothing in the HTML report or trace, `loginPage` undefined at
destructuring, and the `auto: true` `configInfo` fixture never running. See
[src/fixtures/README.md](src/fixtures/README.md) and [src/base/README.md](src/base/README.md).

### 5. `waitForEnter()` was never defined — and isn't needed

Playwright has `page.pause()`, which opens the Inspector and resumes on click.
Better than a hand-rolled stdin wait, and it works in the same test context.

### 6. File locations

`auth/session.json` would need a new `.gitignore` rule.
**`playwright/.auth/` is already gitignored** in this repo — it is Playwright's
own documented location. Use it and no ignore changes are needed.

Also: the original calls this a "sub-agent". It is a helper module, not a Claude
Code subagent — and this repo now has a real one at
[.claude/agents/senior-qa.md](.claude/agents/senior-qa.md). Renamed here to avoid
the collision.

---

## Implementation plan

### Files

| Path | Purpose |
|---|---|
| `src/constants/environment.config.ts` | The `NETWORK_ENV` flag, validated. Lives in `constants/` per convention — no new `config/` directory |
| `tests/auth.setup.ts` | Setup project: logs in live, persists `storageState` |
| `tests/auth.save-session.ts` | Manual, WFH-only: pauses for a human to complete MFA, then persists |
| `playwright.config.ts` | Setup project, `dependencies`, `storageState` wiring |
| `playwright/.auth/session.json` | The persisted state — already gitignored |
| `.env.example` | Add `NETWORK_ENV` with a placeholder |

### 1. The flag

```ts
// src/constants/environment.config.ts
export const NETWORK_ENVS = ['project', 'wfh'] as const;
export type NetworkEnv = (typeof NETWORK_ENVS)[number];

function resolveNetworkEnv(): NetworkEnv {
    const raw = (process.env.NETWORK_ENV ?? 'project').toLowerCase();

    // Fail loudly on a typo. Falling back to 'project' on an unrecognised value
    // would attempt a live login off-network and hang on an MFA push instead.
    if (!NETWORK_ENVS.includes(raw as NetworkEnv)) {
        throw new Error(
            `Invalid NETWORK_ENV "${process.env.NETWORK_ENV}". Expected one of: ${NETWORK_ENVS.join(' | ')}`,
        );
    }
    return raw as NetworkEnv;
}

export const networkEnv = resolveNetworkEnv();

export const env = {
    networkEnv,
    /** Project laptop on the project network — Conditional Access does not challenge MFA. */
    isProjectNetwork: networkEnv === 'project',
    /** Off-network or unregistered device — Authenticator will be pushed, so live login cannot be automated. */
    isWFH: networkEnv === 'wfh',
} as const;
```

Defaulting to `project` keeps the common on-site case zero-config. Validating
the value is the important part: `NETWORK_ENV=WFH` or `=home` would otherwise
silently mean "project".

### 2. Setup project — reuses the existing page objects

```ts
// tests/auth.setup.ts
import { test as setup } from '@fixtures/base.fixture.ts';
import { test_credentials } from '@root/playwright.config.ts';
import { STORAGE_STATE } from '@constants/environment.config.ts';

setup('authenticate via Microsoft SSO and persist session', async ({
    page, loginPage, microsoftLoginPage, logger,
}) => {
    await logger.step('NAVIGATE_TO_LOGIN_PAGE', async () => {
        await loginPage.navigate();
    });

    await logger.step('ENTER_PORTAL_EMAIL', async () => {
        await loginPage.login(test_credentials.valid_username_1);
    });

    await logger.step('COMPLETE_MICROSOFT_SIGN_IN', async () => {
        await microsoftLoginPage.login(
            test_credentials.valid_username_1,
            test_credentials.valid_password_1,
        );
    });

    await logger.step('PERSIST_SESSION_STATE', async () => {
        await microsoftLoginPage.expectRedirectedBackToApp();
        await page.context().storageState({ path: STORAGE_STATE });
    });
});
```

Note it reuses `LoginPage` and `MicrosoftLoginPage` unchanged — no auth logic is
duplicated, and any fix to the login flow benefits both this and `Login.spec.ts`.

### 3. Config wiring

```ts
// playwright.config.ts (sketch)
projects: [
    // Only meaningful on the project network; off-network there is no way to
    // clear an MFA push unattended, so the state must be pre-saved instead.
    ...(env.isProjectNetwork
        ? [{ name: 'setup', testMatch: /auth\.setup\.ts/ }]
        : []),

    {
        name: 'chromium',
        use: { viewport: null, storageState: STORAGE_STATE },
        ...(env.isProjectNetwork ? { dependencies: ['setup'] } : {}),
    },
    // firefox, webkit likewise
]
```

The conditional-spread idiom matches the existing
`...(process.env.CI ? { workers: 1 } : {})` and is required under
`exactOptionalPropertyTypes`.

### 4. ⚠️ `Login.spec.ts` must opt *out* of the shared session

This is the detail the original design misses. If every project starts
authenticated, the login test no longer tests login — it starts already signed
in and its assertions become meaningless while still passing. That is a
false-confidence failure, not a nuisance.

`Login.spec.ts` needs a clean context:

```ts
// tests/Login.spec.ts
test.use({ storageState: { cookies: [], origins: [] } });
```

Login stays covered exactly once, deliberately, from a cold start; everything
else consumes the session.

### 5. Saving a session by hand (WFH)

```ts
// tests/auth.save-session.ts — run manually:
//   NETWORK_ENV=wfh npx playwright test tests/auth.save-session.ts --headed --project=chromium
import { test as save } from '@fixtures/base.fixture.ts';
import { STORAGE_STATE } from '@constants/environment.config.ts';

save('save a session manually (completes MFA by hand)', async ({ page, loginPage, logger }) => {
    save.setTimeout(5 * 60_000);   // a human has to approve a push

    await logger.step('OPEN_LOGIN_PAGE', async () => {
        await loginPage.navigate();
    });

    // Opens the Playwright Inspector. Sign in by hand, approve the
    // Authenticator prompt, land on the portal, then press Resume.
    await page.pause();

    await logger.step('PERSIST_SESSION_STATE', async () => {
        await page.context().storageState({ path: STORAGE_STATE });
    });
});
```

### 6. Running

```bash
# Project laptop, project network — authenticates itself
npx playwright test

# WFH / AVD — save a session first, then run
NETWORK_ENV=wfh npx playwright test tests/auth.save-session.ts --headed --project=chromium
NETWORK_ENV=wfh npx playwright test
```

On Windows `cmd`, use `set NETWORK_ENV=wfh &&`; in PowerShell,
`$env:NETWORK_ENV='wfh';`. Putting `NETWORK_ENV` in `.env` avoids the
shell-syntax difference entirely and is the better habit.

---

## Security

| Item | Requirement |
|---|---|
| `playwright/.auth/session.json` | Already gitignored. **Treat it as more sensitive than the password** — it is a bearer token that has *already satisfied MFA*, so it defeats the second factor for anyone who holds it |
| Never commit it | Same trap as `.env`: `.gitignore` only protects files git is not already tracking. One `git add -f` and it is permanent — see [README.md](README.md) § Setup |
| Credentials | `.env` only, never in source. See the masking rules in [CLAUDE.md](CLAUDE.md) |
| AVD | The AVD needs its own `session.json`; do not pass one between machines over chat or a shared drive |
| Rotation | Deleting an expired file is not revocation. If a state file leaks, the account's sessions must be revoked in Entra ID |

---

## Known risks

1. **CA policy drift.** IT can tighten policy silently; symptom is unexplained login timeouts on the project network.
2. **Session expiry mid-run.** Expect re-auth every 1–8 hours in enterprise setups (table below). A long suite can start authenticated and end unauthenticated.
3. **Stale-state failures are misleading.** An expired `session.json` presents as the app misbehaving — tests fail deep in a flow with odd errors rather than at login. Worth a cheap guard in setup: assert a known post-login element before trusting the state, and fail with "session expired, re-run auth.save-session" rather than letting 40 tests fail obscurely.
4. **`storageState` may not capture everything.** If the portal keeps anything in `sessionStorage` (which `storageState` does *not* persist) or relies on a device-bound token, reuse may not work at all. **This needs a spike before committing to the approach.**

### Session lifetimes (reference)

| Session type | Default |
|---|---|
| Access token | 1 hour |
| Refresh token | 24 hours (active) |
| Browser / SSO cookie | Until browser closes |
| Persistent sign-in cookie | Up to 90 days |
| MFA claim in token | 1 hour (configurable) |

---

## Open questions

1. **Does `storageState` reuse actually work against this portal?** Risk 4 above. One spike answers it and gates everything else.
2. **Will IT provide a service account with a CA exemption?** Removes all of this. Worth asking now, in parallel — the answer takes longer to obtain than the code takes to write.
3. **Is there an API for auth (Option 2)?** Would be faster and more stable than any UI path.
4. **What is the actual MFA claim lifetime on this tenant?** Determines how often a WFH developer must re-save, and therefore whether this is tolerable day to day.

---

## Next steps

1. Spike question 1 — save a state by hand, confirm a second run starts authenticated. **Do this before writing any of the above.**
2. Raise the service-account request with IT.
3. If the spike passes, implement in the order listed under Implementation plan, adding `NETWORK_ENV` to `.env.example` in the same change.
4. Add the stale-session guard from risk 3.
