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
   | `BASE_URL` | always | Portal base URL — `baseURL` for `page.goto()` |
   | `VALID_USERNAME_1` | always | Microsoft SSO test account |
   | `VALID_PASSWORD_1` | always | Password for that account |
   | `VALID_OTP_SECRET_1` | only for the SSO login spec's MFA step | TOTP seed for the account's authenticator |
   | `DATA_ENRICHMENT_DB_SERVER` / `_NAME` / `_USER` / `_PASSWORD` / `_PORT` | only for `dbConnection`-backed specs | Pre-production `data_enrichment` database. Use a read-only (`db_datareader`) account. |
   | `MEMBERSHIP_DB_SERVER` / `_NAME` / `_USER` / `_PASSWORD` / `_PORT` | only for `membershipDbConnection`-backed specs | Separate server/credentials from the DB above. Same read-only-account guidance applies. |
   | `LOG_LEVEL` | no | `DEBUG` \| `INFO` \| `STEP` \| `WARN` \| `ERROR` — defaults to `INFO` |

   `requireEnv()` in [playwright.config.ts](playwright.config.ts) throws at config-load
   time — but not all of the above eagerly. `BASE_URL`/`VALID_USERNAME_1`/`VALID_PASSWORD_1`
   are checked immediately, so the suite will not start at all without them. The rest are
   lazy getters, checked only the first time a spec that actually needs them reads the
   value — a UI-only run never has to configure DB credentials, and a DB-only run never
   has to configure the SSO account. See the comments on `db_config`/`membership_db_config`
   in [playwright.config.ts](playwright.config.ts) for why.

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

## Running tests

There are no `npm` scripts defined; use the Playwright CLI directly.

```bash
npx playwright test                          # run the full suite (db, msedge, firefox, webkit)
npx playwright test tests/Login.spec.ts      # run a single spec file
npx playwright test -g "Successful login"    # run a single test by title
npx playwright test --project=msedge         # run against one browser only
npx playwright show-report                   # open the last HTML report
npx playwright codegen <url>                 # record a new flow/locators
```

Browsers run **headed** and maximized locally by default; `headless` is forced on
automatically when `CI` is set, since a CI runner has no display (see
[playwright.config.ts](playwright.config.ts)). DB-backed specs (`Database.spec.ts`)
run under their own `db` project instead of the browser projects — they touch no
page, so running them under msedge/firefox/webkit too would just be the same
query three times over.

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
                test_credentials.valid_password_1
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
  fixtures/     Custom test fixtures (page objects, DB connections, logger)
  pages/        Page objects (one per screen/flow)
  utils/db.util.ts  MSSQL (DbConnection) and in-process SQLite Wasm connection wrappers
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
