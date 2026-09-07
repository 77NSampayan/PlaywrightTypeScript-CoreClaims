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

2. Create a `.env` file in the project root with:

   ```
   BASE_URL=<portal base URL>
   VALID_USERNAME_1=<test account email>
   VALID_PASSWORD_1=<test account password>
   LOG_LEVEL=INFO
   ```

   `BASE_URL`, `VALID_USERNAME_1`, and `VALID_PASSWORD_1` are required — the config throws on startup if any are missing. `LOG_LEVEL` is optional (`DEBUG` | `INFO` | `STEP` | `WARN` | `ERROR`, defaults to `INFO`).

   `.env` is gitignored — never commit real credentials.

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
