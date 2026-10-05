# src/fixtures

## `base.fixture.ts`

Extends Playwright's `test` with the framework's custom fixtures. Specs should import `test`/`expect` from here — **never** import them directly from `@playwright/test`:

```ts
import { test, expect } from '@fixtures/base.fixture.ts';
```

### Fixtures provided

| Fixture | Scope | Purpose |
|---|---|---|
| `configInfo` | worker, `auto: true` | Runs once per worker before any test. Logs the active project name, worker/parallel index, `BASE_URL`, `LOG_LEVEL`, Node version, and platform via `logger.step(...)`, so the config used for the run is visible at the top of every worker's output. Marked `auto: true` — it always runs; you never need to declare it in a test. Deliberately does **not** depend on `{ browser }` — that would launch a browser per worker just to print this banner, including for the browser-less `db` project. |
| `logger` | test | Calls `logger.setTestContext(testInfo.title)` before the test (prints the START banner) and `logger.endTest(passed)` after (prints the END banner; dumps the log buffer on failure). Yields the shared `SmartLogger` instance — see [`src/utils/logger/README.md`](../utils/logger/README.md). |
| `assert` | test | Yields a `GenericAssertions` instance — plain-value assertions (`toEqual`, `toContain`, ...) for specs with no Locator/Page to hang them off, e.g. `Database.spec.ts`. See [`src/base/README.md`](../base/README.md). |
| `loginPage` | test | Yields a new `LoginPage(page)` — see [`src/pages/login.page.ts`](../pages/login.page.ts). |
| `microsoftLoginPage` | test | Yields a new `MicrosoftLoginPage(page)` — see [`src/pages/microsoft-login.page.ts`](../pages/microsoft-login.page.ts). |
| `landingPage` | test | Yields a new `LandingPage(page)` — see [`src/pages/landing.page.ts`](../pages/landing.page.ts). |
| `dbConnection` | test | Opens a `DbConnection` against the pre-production `data_enrichment` database before the test and closes it after — see [`src/utils/db.util.ts`](../utils/db.util.ts). |
| `membershipDbConnection` | test | Same as `dbConnection`, against the separate Membership database (`membership_db_config`). |
| `sqliteConnection` | test | Opens an in-process `SqliteWasmConnection`, seeds a `claims` table (`seedClaimsTable()`), and closes it after the test. No external server involved. |

### Also re-exported from here

- `expect` (re-exported from `@playwright/test`)
- `uiEndPoints` (re-exported from [`@constants/endpoint.config.ts`](../constants/endpoint.config.ts))

### Usage in a spec

```ts
import { test } from '@fixtures/base.fixture.ts';

test('example', async ({ loginPage, microsoftLoginPage, logger }) => {
    await logger.step('LOGIN', async () => {
        await loginPage.navigate();
        await loginPage.login('user@example.com');
    });
});
```

You only need to destructure the fixtures a given test actually uses (`page` is still available too, inherited from base Playwright — most tests won't need it directly since page objects wrap it).

### Adding a new page object fixture

When a new page object is added under `src/pages/`, register it here rather than constructing it inline in a spec:

1. Add its type to `TestFixtures`.
2. Add a fixture entry that does `async ({ page }, use) => { await use(new MyPage(page)); }`.

This keeps page-object construction out of test bodies and consistent with `loginPage`/`microsoftLoginPage`.
