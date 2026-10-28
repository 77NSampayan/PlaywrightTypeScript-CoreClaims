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
   | `VALID_USERNAME_n` / `VALID_PASSWORD_n` / `VALID_OTP_SECRET_n` (n = 2, 3, …) | no | Extra test accounts, read until the first missing `VALID_USERNAME_n`. Each account is bound to one parallel worker, so the run uses as many workers as accounts. |
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
> `.env` as `VALID_OTP_SECRET_n` for that account (`VALID_OTP_SECRET_1` for account 1).

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

## OP Teleconsultation pipeline & the Control Code Tracker

Each intake Control Code (`OPEML<date><counter>T`, also the intake file name)
moves through ten stages over a couple of hours, with DE batch jobs (every 15–30
min) in between. **`test-data/control-code-tracker.xlsx`** records where every
code is. Each spec reads it to decide which codes it may process, and writes back
when a stage starts, passes, fails or times out. The file is created on first
use, and `test-data/` is gitignored.

| Stage | Run | Eligible when |
|---|---|---|
| S0 Intake file creation | `node scripts/generate-intake-batches.ts` (or IntakeUpload's own fallback) | — the generator registers each code as `IN_PROGRESS`, then `PASSED` once its file is written |
| S1 Intake upload | `tests/IntakeUpload.spec.ts` (`api`) | S0 passed, not yet uploaded |
| S2 Memo upload | `tests/ClaimMemoUpload.spec.ts` (`api`) | S1 passed and a row has Action Memo = Y (otherwise N/A) |
| S3 Intake processed | `tests/PipelineSignalCheck.spec.ts` (`db`) | 15–60 min after S1/S2. **Skipped for now** (no DE database access): set to N/A as each code reaches it — see below |
| S4 Visible in Core Claims | `tests/ClaimsQueryCheck.spec.ts` (`msedge`) | S3 passed or skipped. While S3 is skipped, presence only (no DB row counts) — run it 15+ min after S2 |
| S5 Payment Journal / Disbursement | `tests/PaymentJournalUpload.spec.ts` (`api`) | S4 passed |
| S6 Payment processed · S7 EP No / NAV pay ref | `tests/PipelineSignalCheck.spec.ts` (`db`) | 30–60 min after the previous stage |
| S8 Return File (DPS/UB) / F2307 (COMCHECK) | `tests/ReturnFileUpload.spec.ts` / `tests/F2307Upload.spec.ts` (`api`) | S7 passed |
| S9 Transmittal + F2307 | `tests/PipelineSignalCheck.spec.ts` (`db`) | 30–60 min after S8 |
| S10 Email | **by hand for now**: set `S10 Status` to `PASSED` | S9 passed |

Creating intake files prints what happened to the tracker as it goes:

```text
── Intake file creation · RUN-20261026-1630 ──────────────────────────
[EXECUTING] 6 control code(s) registered in the tracker as S0 IN_PROGRESS
  ✓ OPEML2026102648213T  DPS       NEGATIVE  2 row(s), 1 Action Memo  → test-data/DPS/10.26.26/OPEML2026102648213T.xlsx
  ...
[DONE] 6 intake file(s) created, 0 failed — tracker S0 updated
```

```bash
node scripts/generate-intake-batches.ts            # create intake files (S0) — close the tracker in Excel first
node scripts/init-control-code-tracker.ts          # one line per code: stage, status, what to run next
npx playwright test --project=db tests/PipelineSignalCheck.spec.ts   # advance every due DE wait
```

**Skipping a stage.** `SKIPPED_STAGES` in
[src/constants/tracker.config.ts](src/constants/tracker.config.ts) lists stages that are
skipped for now, with a reason. A code reaching one gets `N/A` there, with the reason in
Remarks and the Event Log, so the next stage can run. S3 is listed until the DE database
access arrives; S4 then checks only that each code shows up in Claims Query. To bring S3
back, delete its entry: new codes wait at S3 again, and codes already skipped keep their
`N/A`.

How it behaves:

- **Re-running is always safe.** Every spec only touches codes that are
  eligible right now. A passed upload is never uploaded again, and a spec with
  nothing to do is reported as skipped.
- **Waits are single-pass checks, not sleeps.** Before "Next Check At" a code
  is left alone. A check that finds nothing before "Wait Deadline" leaves it
  `WAITING`. A miss after the deadline marks it `TIMED_OUT`: that code stops,
  other codes carry on, the Event Log keeps the evidence, and the check spec
  fails. A timeout is never retried, re-uploaded or extended automatically.
  Change the windows on the **Config** sheet.
- **`FAILED` is retryable, `TIMED_OUT` is not.** A failed upload never reached
  the blob, so re-running the spec retries it. A timed-out wait may still be
  processing in DE, so a person decides what happens next.
- **One Return File per channel per run.** It carries one code's EP Number,
  preferring a POSITIVE code. The channel's other due codes are marked
  `NOT_COVERED` and end there, by design.
- **Close the file in Excel before running specs.** Specs rebuild the whole
  workbook on every write, so only cell values survive, not hand formatting.
  An open file makes a write fail with a clear "close it in Excel" error.
- **Resetting a code by hand:** with Excel closed afterwards, clear the
  status of the stage to retry *and every later stage*, then add a Remark. A
  code whose later stage still says `TIMED_OUT` or `NOT_COVERED` is not
  re-entered.
- **Lookups not confirmed yet.** Several DE tables' control-code columns are
  still [TBC]. The check finds them at run time from `INFORMATION_SCHEMA`. When
  it can't pin a column down, it writes a Remark (`signal lookup unresolved —
  confirm by hand`) and leaves the code `WAITING`; it never times the code out
  for that.

### Pipeline state on the runner

GitHub Actions keeps one tracker for every control code CI generates. The
[OP intake workflow](.github/workflows/op-intake-pipeline.yml) runs only on the
self-hosted runner labelled `op-pipeline` (AVD-BASCL06-0). Its
[pipeline-state action](.github/actions/pipeline-state/) copies the git-ignored state
in before the stages run and back out afterwards, even when a stage failed:

| Kept | Where on the runner (`%USERPROFILE%\claims-qa-state\`) |
|---|---|
| Tracker + intake files (`test-data/`) | `op-pipeline\test-data\` |
| Control numbers used today (`scripts/.intake-sequence-state.json`) | `op-pipeline\.intake-sequence-state.json` |
| What the last run saved, and which run | `op-pipeline\store.json` |
| Tracker + counter before each run, newest 20 | `op-pipeline-snapshots\<timestamp>-run<N>\` |

Local runs are not part of this: your machine keeps its own tracker. To see CI's, open a
run's summary (tracker status before and after) or download its `control-code-tracker`
artifact, kept 30 days.

**First run on a runner.** A run stops with "No pipeline state found" until the state
exists, because starting empty would lose the tracker's history and the record of
control numbers already used. Run the workflow once with **initialize_state** ticked and
S0–S2 unticked. To carry existing codes over, first copy a local `test-data\` and
`scripts\.intake-sequence-state.json` into `op-pipeline\` on the runner.

**"Pipeline state is damaged".** A file the last run saved is gone. Restore it:

1. Make sure no pipeline workflow is running.
2. On the runner, copy `control-code-tracker.xlsx` from the newest good folder under
   `op-pipeline-snapshots\` into `op-pipeline\test-data\`, and
   `.intake-sequence-state.json` into `op-pipeline\`.
3. Run the workflow with S0–S2 unticked and check "Tracker status (before)".

The same steps roll back a run that wrote a bad tracker: use the snapshot taken before
that run.

To test the action without a runner:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File .github/actions/pipeline-state/pipeline-state.tests.ps1
```

## Writing test specs

Specs are plain Playwright Test scripts — `test.describe` / `test` / `test.beforeEach` — not Cucumber/Gherkin `.feature` files. There's no separate BDD framework here, but the tests are still capable of reading like BDD scenarios: `logger.step(...)` gives each Given/When/Then-style beat of the flow a named block, both in the console and as a collapsible node in the HTML report/trace viewer.

Example, based on [`tests/Login.spec.ts`](tests/Login.spec.ts) and [`src/pages/login.page.ts`](src/pages/login.page.ts):

```ts
import { test } from '@fixtures/base.fixture.ts';

test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
});

test.describe('Amplify Health Product Portal - Login', () => {
    // `account` = this worker's own test account (see CLAUDE.md § Projects)
    test('Successful login via Microsoft SSO with valid credentials', async ({ account, loginPage, microsoftLoginPage, logger }) => {
        await logger.step('VERIFY_LOGIN_PAGE', async () => {          // Given
            await loginPage.expectLoginPageVisible();
        });

        await logger.step('ENTER_PORTAL_EMAIL', async () => {         // When
            await loginPage.login(account.username);
        });

        await logger.step('COMPLETE_MICROSOFT_SIGN_IN', async () => { // When
            await microsoftLoginPage.login(
                account.username,
                account.password,
                account.otpSecret        // automated MFA — see § Authentication & MFA
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

Every wrapped action/assertion logs one `✓`/`✗` line with its duration to the console (`[START]` lines too at `LOG_LEVEL=DEBUG`) and opens a matching step in the Playwright HTML report and trace viewer. On a test failure, the last 200 log lines — `DEBUG` ones included — are dumped automatically regardless of `LOG_LEVEL`. View the latest report with:

```bash
npx playwright show-report
```

### Failure artifacts (`screenshot` / `trace`)

On a **failed** test (configured in [playwright.config.ts](playwright.config.ts) `use`):

- **Screenshot** — a final-state screenshot is attached to **both** the HTML report and the Allure report (the `allure-playwright` reporter picks up Playwright's test-result attachment automatically — no `allure.attachment()` call needed). This runs locally *and* in CI.
- **Trace** — `trace: 'retain-on-failure'` **locally only**; it is turned **off under CI** (`trace: process.env.CI ? 'off' : 'retain-on-failure'`). A trace bundles full DOM snapshots and network payloads of authenticated claim/member pages, and both CI pipelines upload the reports as artifacts — so CI deliberately produces only the lighter screenshot, never a trace, to keep that PII out of shared artifacts. Open a local trace from the trace viewer via `npx playwright show-report` (click the failed test) or `npx playwright show-trace <trace.zip>`.

Passing tests produce **no** screenshot or trace, so clean runs stay artifact-free.

> **PII note.** A screenshot photographs the rendered DOM as-is, bypassing the `fill({ mask: true })` masking that keeps identifying values out of logs. That is why CI report artifacts use a short retention window (`retention-days: 3` on GitHub; set the pipeline run-retention policy to minimum on Azure DevOps, which has no per-artifact retention in YAML).

## Reviewing your changes

Before opening a PR, run `/senior` in Claude Code to get an automated review against this repo's conventions — see [REVIEW.md](REVIEW.md) for how to use it and a pre-flight checklist of the mistakes it catches most often.
