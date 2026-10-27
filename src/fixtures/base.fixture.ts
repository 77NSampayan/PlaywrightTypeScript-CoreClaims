import { test as base } from '@playwright/test';
// import { AuthenticationAPI } from '../../api/authentication/authentication-api.ts';
import { logger, type SmartLogger } from '@utils/logger/SmartLogger.util.ts';
import { DbConnection, SqliteWasmConnection } from '@utils/db.util.ts';
import { db_config, membership_db_config, test_accounts, type TestAccount } from '@root/playwright.config.ts';
import { storageStateFor } from '@constants/environment.config.ts';
import { GenericAssertions } from '@base/GenericAssertions.util.ts';
import { LoginPage } from '@pages/login.page.ts';
import { MicrosoftLoginPage } from '@pages/microsoft-login.page.ts';
import { LandingPage } from '@pages/landing.page.ts';
import { AzureStorageSasPage } from '@pages/azure-storage-sas.page.ts';
import { OutlookMailPage } from '@pages/outlook-mail.page.ts';
import { ControlCodeTracker } from '@utils/tracker/ControlCodeTracker.util.ts';


export type TestFixtures = {
    // authentication: AuthenticationAPI;
    logger: SmartLogger;
    // Plain-value assertions with no Locator/Page involved (toEqual, toContain,
    // ...) — for specs with no page object to hang them off, e.g. Database.spec.ts.
    assert: GenericAssertions;
    loginPage: LoginPage;
    microsoftLoginPage: MicrosoftLoginPage;
    dbConnection: DbConnection;
    membershipDbConnection: DbConnection;
    sqliteConnection: SqliteWasmConnection;
    landingPage: LandingPage;
    azureStorageSasPage: AzureStorageSasPage;
    outlookMailPage: OutlookMailPage;
    // The Control Code Tracker workbook (test-data/control-code-tracker.xlsx):
    // which codes each pipeline stage may process now, and where to record
    // what happened. Stateless — every call re-reads the file.
    tracker: ControlCodeTracker;
};

export type WorkerFixtures = {
    configInfo: void;   // worker-scoped: runs once per worker, not per test
    // This worker's own Microsoft SSO account — the one its saved session
    // (the `storageState` override below) is signed in as.
    account: TestAccount;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({

    // ── Worker-scoped: logs config once at the start of each worker ──
    // No `{ browser }` dependency: pulling in a live browser here would launch
    // one for every worker just to print a banner — including for the `db`
    // project, whose specs never touch a page at all.
    configInfo: [async ({}, use, workerInfo) => {

        // ─────────────────────────────────────────────────────
        //  Runs once before the entire test suite.
        //  Logs active configuration so it appears at
        //  the top of every test run output for verification.

        logger.setTestContext('CONFIG INFO');

        await logger.step('PLAYWRIGHT CONFIGURATION', async () => {
            logger.highlight(`Project            : "${workerInfo.project.name}"`);
            logger.highlight(`Worker index       : "${workerInfo.workerIndex}"`);
            logger.highlight(`Parallel index     : "${workerInfo.parallelIndex}"`);
            // Slot number only — never the username (see CLAUDE.md on identifiers in logs).
            logger.highlight(`Account slot       : "#${workerInfo.parallelIndex + 1} of ${test_accounts.length}"`);
        });

        await logger.step('ENVIRONMENT', async () => {
            // requireEnv('BASE_URL') in playwright.config.ts already guarantees this
            // is set (and non-empty) by the time any test runs — no fallback text needed.
            logger.highlight(`BASE_URL           : "${process.env.BASE_URL}"`);
            logger.highlight(`LOG_LEVEL          : "${process.env.LOG_LEVEL ?? 'INFO (default)'}"`);
            logger.highlight(`Node version       : "${process.version}"`);
            logger.highlight(`Platform           : "${process.platform}"`);
        });
 
        logger.endTest(true);
        await use();

        // ─────────────────────────────────────────────────────
 
    }, { scope: 'worker', auto: true }],   // auto: true = no need to declare in tests

    // ── Worker-scoped: one test account per worker ───────────────
    // parallelIndex is in [0, workers - 1] and is kept by the replacement when a
    // worker restarts after a failure, so each account belongs to exactly one
    // worker for the whole run. That only holds while `workers` <= the number of
    // accounts — playwright.config.ts sets it equal; fail loudly if not.
    account: [async ({}, use, workerInfo) => {
        const account = test_accounts[workerInfo.parallelIndex];
        if (!account) {
            throw new Error(
                `Worker slot #${workerInfo.parallelIndex + 1} has no test account: only ` +
                `${test_accounts.length} configured. Lower --workers or add VALID_USERNAME_n accounts.`
            );
        }
        await use(account);
    }, { scope: 'worker' }],

    // ── Built-in override: start signed in as this worker's account ──
    // Loads the session tests/auth.setup.ts saved for the account above. A spec
    // or describe that calls test.use({ storageState: ... }) replaces this
    // entirely — e.g. Login.spec.ts and auth.setup.ts start signed out.
    storageState: async ({}, use, testInfo) => {
        await use(storageStateFor(testInfo.parallelIndex));
    },

    // // ── Test-scoped: logger context reset per test ───────────────
    // authentication: async ({}, use) => {
    //     const authentication = await new AuthenticationAPI();
    //     await use(authentication);
    // },

    // ── Test-scoped: API client ───────────────────────────────────
    logger: async ({}, use, testInfo) => {
        // Fires before each test — sets context and prints START banner
        logger.setTestContext(testInfo.title);

        await use(logger);

        // Fires after each test - prints END baner; dumps buffer on failure
        const passed = testInfo.status === testInfo.expectedStatus;
        logger.endTest(passed);
    },

    assert: async ({}, use) => {
        await use(new GenericAssertions(logger));
    },

    // ── Test-scoped: page object ──────────────────────────────────
    loginPage: async ({ page }, use) => {
        await use(new LoginPage(page));
    },

    microsoftLoginPage: async ({ page }, use) => {
        await use(new MicrosoftLoginPage(page));
    },

    // ── Test-scoped: DB connections, opened/closed around the test ──
    // Depend on `{ logger }`, not just imported directly: fixture setup/teardown
    // order follows dependencies, not destructuring order in the test. Without
    // this, connect() can run before logger.setTestContext() resets the buffer
    // for this test, so its logs land under the previous test's banner — and a
    // connect() failure means the logger fixture never finishes setting up, so
    // endTest(false) never fires and there's no END banner or failure dump.
    dbConnection: async ({ logger }, use) => {
        const dbConnection = new DbConnection(db_config);
        await logger.step('OPEN_DB_CONNECTION', async () => dbConnection.connect());
        await use(dbConnection);
        await logger.step('CLOSE_DB_CONNECTION', async () => dbConnection.close());
    },

    membershipDbConnection: async ({ logger }, use) => {
        const membershipDbConnection = new DbConnection(membership_db_config);
        await logger.step('OPEN_MEMBERSHIP_DB_CONNECTION', async () => membershipDbConnection.connect());
        await use(membershipDbConnection);
        await logger.step('CLOSE_MEMBERSHIP_DB_CONNECTION', async () => membershipDbConnection.close());
    },

    // ── Test-scoped: in-process SQLite Wasm DB, pre-seeded and ready by the time the test body runs ──
    sqliteConnection: async ({ logger }, use) => {
        const sqliteConnection = new SqliteWasmConnection();
        await logger.step('OPEN_SQLITE_CONNECTION', async () => {
            await sqliteConnection.connect();
            await sqliteConnection.seedClaimsTable();
        });
        await use(sqliteConnection);
        await logger.step('CLOSE_SQLITE_CONNECTION', async () => sqliteConnection.close());
    },
   landingPage: async ({ page }, use) => {
        await use(new LandingPage(page));
    },

    azureStorageSasPage: async ({ page }, use) => {
        await use(new AzureStorageSasPage(page));
    },

    outlookMailPage: async ({ page }, use) => {
        await use(new OutlookMailPage(page));
    },

    // ── Test-scoped: Control Code Tracker ─────────────────────────
    // No page dependency, so the browser-less `db` project can use it too.
    tracker: async ({}, use) => {
        await use(new ControlCodeTracker());
    },
});

export { expect } from '@playwright/test'
export { uiEndPoints } from '@constants/endpoint.config.ts'