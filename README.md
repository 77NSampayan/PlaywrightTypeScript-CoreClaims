# PlaywrightTS-CoreClaims

Playwright + TypeScript UI automation for the Amplify Health Product Portal (Core Claims), including its Microsoft SSO login flow.

## Tech stack

- [Playwright Test](https://playwright.dev/) (`@playwright/test`)
- TypeScript (ESM, executed directly — no build step)
- Custom `SmartLogger` for structured, colorized console logging with automatic Playwright trace/report step grouping

## Prerequisites

- Node.js
- Playwright browser binaries (installed via `npx playwright install`)

## Setup

1. Install dependencies:

   ```bash
   npm install
   npx playwright install
   ```

2. Create your local `.env` from the tracked template:

   ```bash
   cp .env.example .env      # Windows (cmd):  copy .env.example .env
   ```

   Then open `.env` and replace the placeholder values with the real ones for
   your environment. [.env.example](.env.example) documents each variable, but in short:

   | Variable | Required | Notes |
   |---|---|---|
   | `BASE_URL` | yes | Portal base URL — `baseURL` for `page.goto()` |
   | `VALID_USERNAME_1` | yes | Microsoft SSO test account |
   | `VALID_PASSWORD_1` | yes | Password for that account |
   | `VALID_OTP_SECRET_1` | yes | TOTP secret for that account's authenticator app — powers automated MFA (see [§ Authentication & MFA](#authentication--mfa-microsoft-sso)). Validated lazily, so runs that never reach the SSO flow don't need it |
   | `LOG_LEVEL` | no | `DEBUG` \| `INFO` \| `STEP` \| `WARN` \| `ERROR` — defaults to `INFO` |

   `requireEnv()` in [playwright.config.ts](playwright.config.ts) throws at config-load
   time if either credential is missing or empty, so the suite will not start until
   `.env` exists and is filled in.

   > ### ⚠️ Never commit `.env`
   >
   > `.env` holds **real working credentials** once you fill it in. Only
   > `.env.example` — which contains placeholders — belongs in git.
   >
   > `.env` is listed in [.gitignore](.gitignore), so git will refuse to add it
   > by accident. **Do not override that with `git add -f`, and do not use an
   > IDE "stage anyway" action on it.** The rule only protects files git isn't
   > already tracking: once `.env` is committed even once, `.gitignore` becomes
   > silently inert for it and every later edit is stageable like any normal
   > file.
   >
   > If `git ls-files .env` ever returns a result, untrack it immediately with
   > `git rm --cached .env` (your local file is left on disk), and **rotate the
   > account password** — deleting the file does not remove it from history, so
   > the value stays recoverable from the commits that contained it.
   >
   > When you add a new variable, add it to `.env.example` with a placeholder
   > too, so the next person's copy isn't missing it.

## Authentication & MFA (Microsoft SSO)

The portal signs in through Microsoft SSO, and the test account's second factor
is resolved automatically during a run — no physical device or manual approval.

### How it works

The automation account (`VALID_USERNAME_1`) has an authenticator app registered
in **TOTP / one-time-code mode**, so its second factor is a 6-digit code derived
from a shared secret rather than a push notification. Playwright computes that
code exactly the way an authenticator app does, using the
[`otpauth`](https://github.com/hectorm/otpauth) library:

- [`src/utils/totp.util.ts`](src/utils/totp.util.ts) — `generateTOTP(secret, label)`
  wraps `otpauth`'s `TOTP` (SHA1, 6 digits, 30s period — the Microsoft default).
- [`src/pages/microsoft-login.page.ts`](src/pages/microsoft-login.page.ts) —
  `enterAuthenticatorCode()` generates the code and fills it (masked) when the
  OTP screen appears; `login(email, password, otpSecret)` runs the full flow.

MFA is **conditional** — on a trusted device/network Microsoft may not challenge
it at all. `enterAuthenticatorCode()` handles both cases: it soft-waits for the
OTP field and simply skips code entry when the challenge isn't shown, so the flow
never hangs waiting for a factor that was never requested.

### One-time setup — capturing the TOTP secret

Register the authenticator in code mode once per account and save the secret:

> In Microsoft **Security info → Add sign-in method → Authenticator app →
> "I can't scan the QR code"**, copy the one-time secret shown and put it in
> `.env` as `VALID_OTP_SECRET_1`.

Treat this secret as sensitive — **it is the second factor.** It is masked in all
logs, console output, and the HTML report, and is never printed. Add it to
[.env.example](.env.example) as a placeholder only, never a real value (see § Setup).

### Scope & limitations

- Works only for accounts with a **TOTP** method registered. An account whose
  only factor is an Authenticator **push** cannot be automated this way — there
  is no secret to compute.
- Conditional Access is owned by IT and can change without notice. If sign-ins
  suddenly start timing out on a trusted network, suspect a CA policy change
  before an app defect.

## Running tests

There are no `npm` scripts defined; use the Playwright CLI directly.

```bash
npx playwright test                          # run the full suite (chromium, firefox, webkit)
npx playwright test tests/Login.spec.ts      # run a single spec file
npx playwright test -g "Successful login"    # run a single test by title
npx playwright test --project=chromium       # run against one browser only
npx playwright show-report                   # open the last HTML report
npx playwright codegen <url>                 # record a new flow/locators
```

Browsers run **headed** and maximized by default (see [playwright.config.ts](playwright.config.ts)).

## Writing test specs

Specs are plain Playwright Test scripts — `test.describe` / `test` / `test.beforeEach` — not Cucumber/Gherkin `.feature` files. There's no separate BDD framework here, but the tests are still capable of reading like BDD scenarios: `logger.step(...)` gives each Given/When/Then-style beat of the flow a named block, both in the console and as a collapsible node in the HTML report/trace viewer.

Example, based on [`tests/Login.spec.ts`](tests/Login.spec.ts) and [`src/pages/login.page.ts`](src/pages/login.page.ts):

```ts
import { test } from '@fixtures/base.fixture.ts';
import { test_credentials } from '@root/playwright.config.ts';

test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
});

test.describe('Amplify Health Product Portal - Login', () => {
    test('Successful login via Microsoft SSO with valid credentials', async ({ loginPage, microsoftLoginPage, logger }) => {
        await logger.step('VERIFY_LOGIN_PAGE', async () => {          // Given
            await loginPage.expectLoginPageVisible();
        });

        await logger.step('ENTER_PORTAL_EMAIL', async () => {         // When
            await loginPage.login(test_credentials.valid_username_1);
        });

        await logger.step('COMPLETE_MICROSOFT_SIGN_IN', async () => { // When
            await microsoftLoginPage.login(
                test_credentials.valid_username_1,
                test_credentials.valid_password_1,
                test_credentials.valid_otp_secret_1        // automated MFA — see § Authentication & MFA
            );
        });

        await logger.step('VERIFY_REDIRECT_TO_PORTAL', async () => {  // Then
            await microsoftLoginPage.expectRedirectedBackToApp();
        });
    });
});
```

Conventions to follow:

- Import `test`/`expect` from `@fixtures/base.fixture.ts`, never directly from `@playwright/test` — see [src/fixtures/README.md](src/fixtures/README.md).
- `test.describe` groups the tests for one feature/page; `test.beforeEach` handles setup shared by every test in the block (e.g. navigating to the login page).
- Wrap each logical phase of the test in its own `logger.step(NAME, fn)` call — treat it as a Given/When/Then beat rather than one long unstructured test body. Name steps as `SCREAMING_SNAKE_CASE` phrases describing intent (`VERIFY_LOGIN_PAGE`, `ENTER_PORTAL_EMAIL`), not implementation detail.
- The test body itself should read like a scenario: call page-object `Actions`/`Assertions` methods (`loginPage.login(...)`, `loginPage.expectLoginPageVisible()`) — never raw locators or `expect(...)` calls directly in a spec. See [`src/pages/login.page.ts`](src/pages/login.page.ts) for the method-naming pattern (verb-named methods for actions, `expect...`-prefixed methods for assertions) and [src/base/README.md](src/base/README.md) for what those methods wrap.

### Tagging tests (optional, recommended once you have more than a couple of specs)

Playwright Test supports a native `tag` option — no BDD framework or extra
dependency needed: `test('...', { tag: ['@smoke'] }, async (...) => { ... })`.
Filter a run with `npx playwright test --grep @smoke`.

Tags are **optional** — a spec with no tag is not a convention violation. But
once you do tag a test, use this fixed set so tags stay meaningful across the
suite instead of every author inventing their own:

| Tag | Use for |
|---|---|
| `@smoke` | The small, fast subset that proves the app isn't fundamentally broken — run on every push |
| `@regression` | Broader coverage run less frequently (nightly, pre-release) |
| `@critical` | High business impact — a failure here blocks a release regardless of what else passes |
| `@wip` | Not yet reliable/complete — excluded from CI via `--grep-invert @wip` until promoted |

A test may carry more than one tag (e.g. `{ tag: ['@smoke', '@critical'] }`).
Don't invent a new tag ad hoc — if none of these fit, that's a sign the test
needs a `test.describe` grouping instead, not a fifth tag.

## Project structure

```
src/
  base/         Shared base page + element action/assertion wrappers
  constants/    Endpoint URLs and Playwright option types
  fixtures/     Custom test fixtures (page objects, logger)
  pages/        Page objects (one per screen/flow)
  utils/logger/ SmartLogger, log level, and console formatting
tests/          Playwright specs
```

Page objects extend `BasePage` and expose `Actions`/`Assertions` methods built on `ElementActions` / `ElementAssertions` / `GenericAssertions` — tests never call raw Playwright locator or `expect` APIs directly. See [CLAUDE.md](CLAUDE.md) for the full architecture breakdown and conventions to follow when adding new pages or flows.

## Logging & reports

Every wrapped action/assertion logs a START/END line to the console and opens a matching step in the Playwright HTML report and trace viewer. On a test failure, the last 50 log lines are dumped automatically regardless of `LOG_LEVEL`. View the latest report with:

```bash
npx playwright show-report
```

## Reviewing your changes

Before opening a PR, run `/senior` in Claude Code to get an automated review against this repo's conventions — see [REVIEW.md](REVIEW.md) for how to use it and a pre-flight checklist of the mistakes it catches most often.
