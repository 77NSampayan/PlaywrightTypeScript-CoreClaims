# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Playwright + TypeScript UI test automation for the "Amplify Health Product Portal" (Core Claims), which authenticates via Microsoft SSO. ESM project (`"type": "module"` in package.json), no build step — Playwright runs `.ts` files directly.

## Commands

There are no `npm` scripts defined in package.json — use the Playwright CLI directly via `npx`.

```bash
npx playwright test                          # run the full suite (all 3 browser projects)
npx playwright test tests/Login.spec.ts      # run a single spec file
npx playwright test -g "Successful login"    # run a single test by title
npx playwright test --project=chromium       # run against one browser project only
npx playwright test --headed                 # force headed (headless is already false by default, see below)
npx playwright show-report                   # open the last HTML report
npx playwright codegen <url>                 # record a new locator/flow
```

Type-check without emitting (tsconfig has `"noEmit": true`):

```bash
npx tsc --noEmit
```

## Environment configuration

Config is loaded from `.env` at the repo root via `dotenv` in [playwright.config.ts](playwright.config.ts). Required variables:

- `BASE_URL` — base URL used by `page.goto()` / `baseURL`
- `VALID_USERNAME_1`, `VALID_PASSWORD_1` — test credentials for the Microsoft SSO login flow (`requireEnv()` throws at config-load time if either is missing)
- `LOG_LEVEL` — optional, controls `SmartLogger` verbosity (`DEBUG` | `INFO` | `STEP` | `WARN` | `ERROR`, defaults to `INFO`)

Never commit real values for these or print credential values in logs/output. Pass `{ mask: true }` to `ElementActions.fill()` for any sensitive **or identifying** field — the logged value becomes `********`.

This matters beyond the console: a `fill()` start message is reused as the `test.step()` name, so an unmasked value is published to the HTML report and the trace as well. For the same reason, never interpolate a credential or account identifier into a `logger.step()` label. A `/password|secret|token|creditcard/i` description sniff is retained as a backstop, but do not rely on it — no honest name for an identity field matches a keyword list.

Browsers run **headed** by default (`headless: false` in [playwright.config.ts](playwright.config.ts)) and maximized (`--start-maximized`), with `viewport: null` on the chromium project to use full window size instead of Playwright's default 1280x720.

## Architecture

Layered Page Object Model with structured logging built into the base layer, using TS path aliases (`@root`, `@base`, `@components`, `@constants`, `@fixtures`, `@pages`, `@utils` — defined in [tsconfig.json](tsconfig.json)) instead of relative imports.

**Layering** (each page object composes these rather than calling Playwright APIs directly):

- [src/base/base.page.ts](src/base/base.page.ts) — abstract `BasePage`. Owns the `Page` instance and instantiates one `ElementActions`, `ElementAssertions`, and `GenericAssertions` per page object. Only page/browser-level concerns live here (navigate, reload, go back/forward, close, waitForLoadState/URL, toHaveURL/Title). All child pages get logging for free through these methods — no direct logger calls needed in page objects or tests.
- [src/base/ElementActions.util.ts](src/base/ElementActions.util.ts) — locator interactions (click, fill, check/uncheck, selectOption, getText, waitForVisible/Hidden), each wrapped in `logger.action(...)`.
- [src/base/ElementAssertions.util.ts](src/base/ElementAssertions.util.ts) — locator-level `expect` assertions (toBeVisible/Hidden, toHaveText, toContainText, toBeEnabled, toBeChecked).
- [src/base/GenericAssertions.util.ts](src/base/GenericAssertions.util.ts) — non-locator assertions (toEqual, toContain, toBeTruthy, toBeGreaterThan) for comparing plain values.
- Page objects (e.g. [src/pages/login.page.ts](src/pages/login.page.ts), [src/pages/microsoft-login.page.ts](src/pages/microsoft-login.page.ts)) extend `BasePage`, declare locators in the constructor, and expose `Actions` and `Assertions`-named methods that call `this.elements` / `this.elementAssert` / `this.assert` — never raw Playwright locator/expect calls.

**Every action/assertion call takes a human-readable `description` string** (e.g. `'sign in button'`) — this is what shows up in log lines and the HTML/trace report, so pick descriptions that read naturally in `Asserting element "X" is VISIBLE` / `Clicking element "X"` style output.

**Logging** ([src/utils/logger/](src/utils/logger/)):
- `SmartLogger` ([SmartLogger.util.ts](src/utils/logger/SmartLogger.util.ts)) is a singleton (`export const logger = SmartLogger.getInstance()`), shared by `BasePage` and all its util classes — don't instantiate it directly.
- `logger.action(startMsg, fn, passMsg, failMsg, level?)` is the core primitive: logs START, runs `fn` inside a boxed `test.step()` (so failures report at the caller's call site and steps show up as collapsible nodes in the HTML report/trace viewer), then logs an `[END]` line and rethrows on error. The success line is emitted at the call's own level and the failure line at `ERROR`, so a red `[ERROR]` tag is what marks a failure. Nearly every method in the base/util classes is a thin wrapper around this.
- `logger.step(name, fn)` groups multiple actions under one named step (used in tests, e.g. `Login.spec.ts`'s `logger.step('VERIFY_LOGIN_PAGE', ...)`).
- On test failure, `endTest(false)` dumps the last 50 buffered log lines (`BUFFER_SIZE`) regardless of `LOG_LEVEL`, so failure context is visible even when running quiet.
- `LogFormatter.util.ts` owns all ANSI coloring/timestamp formatting — keep formatting changes there rather than inline in `SmartLogger`.

**Fixtures** ([src/fixtures/base.fixture.ts](src/fixtures/base.fixture.ts)): extends Playwright's `test` with `logger` (auto test-context banner start/end per test) and page-object fixtures (`loginPage`, `microsoftLoginPage`). A worker-scoped `configInfo` fixture (`auto: true`) logs browser/env config once per worker at suite start — no need to declare it in tests. New page objects should be added as fixtures here, not constructed inline in specs. Import `test`/`expect` for specs from this file (`@fixtures/base.fixture.ts`), not directly from `@playwright/test`.

**Constants** ([src/constants/](src/constants/)):
- [endpoint.config.ts](src/constants/endpoint.config.ts) — single source of truth for UI route paths (`uiEndPoints`); never hardcode paths in tests/page objects.
- [page-types.config.ts](src/constants/page-types.config.ts) / [locator-types.config.ts](src/constants/locator-types.config.ts) — option types derived via `Parameters<...>` directly from the installed Playwright `Page`/`Locator`/matcher APIs, so they stay in sync with the Playwright version automatically. Follow this same derivation pattern when adding option types for new wrapped methods, rather than hand-writing option interfaces.

**Credentials**: `test_credentials` is defined and exported from [playwright.config.ts](playwright.config.ts) (not a separate constants file) and imported into specs via `@root/playwright.config.ts`.

## Adding a new page/flow

1. Add any new endpoint to [endpoint.config.ts](src/constants/endpoint.config.ts).
2. Create the page object under `src/pages/`, extending `BasePage`, with locators in the constructor and `Actions ─/─ Assertions` sections (follow the `// ─── Actions ──────────────────────────────` comment banner style used in existing page objects).
3. Register it as a fixture in [base.fixture.ts](src/fixtures/base.fixture.ts).
4. Write the spec under `tests/`, importing `test`/`expect` from `@fixtures/base.fixture.ts`, using `logger.step(...)` to group logical phases of the test.

## The `senior-qa` review agent

`/senior` delegates to the [senior-qa](.claude/agents/senior-qa.md) subagent — a
read-only reviewer with two modes: `REVIEW` (conventions, correctness, flakiness) and
`COVERAGE` (test design and gaps). Bare `/senior` reviews uncommitted changes;
`/senior <path>` reviews specific files; `/senior coverage` analyses gaps.

It reports ranked findings and never edits. When relaying its report, pass it through
unmodified rather than summarising it — then apply whatever the user asks for.

**It deliberately does not handle mentoring or architecture questions**, which belong
in this conversation instead, because both are dialogues and a subagent returns one
report and cannot take a follow-up.

### Answering framework questions here

When asked *why* a convention exists, or for advice on extending the framework:

1. **Read the relevant `src/*/README.md` before answering** — do not answer from
   memory or from generic Playwright practice. Those files carry the rationale, not
   just the rule ([src/constants/README.md](src/constants/README.md) has a `### Why`
   section; the base and logger READMEs have `## Conventions`).
2. **Trace the mechanism.** Say what concretely breaks, naming files and lines — not
   "it's inconsistent." For example: importing `test` from `@playwright/test` gives
   you bare Playwright, so `loginPage` is `undefined` at destructuring *and* the
   `auto: true` worker fixture `configInfo` never runs, silently costing the run its
   config banner.
3. **Name the trade-off the convention accepts.** Every rule costs something. A rule
   presented as free is one the engineer won't be able to defend, or know when to
   break.
