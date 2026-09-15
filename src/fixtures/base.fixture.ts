import { test as base } from '@playwright/test';
// import { AuthenticationAPI } from '../../api/authentication/authentication-api.ts';
import { logger, type SmartLogger } from '@utils/logger/SmartLogger.util.ts';
import { DbConnection, SqliteWasmConnection } from '@utils/db.util.ts';
import { db_config, membership_db_config } from '@root/playwright.config.ts';
import { GenericAssertions } from '@base/GenericAssertions.util.ts';
import { LoginPage } from '@pages/login.page.ts';
import { MicrosoftLoginPage } from '@pages/microsoft-login.page.ts';
import { LandingPage } from '@pages/landing.page.ts';


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
};

export type WorkerFixtures = {
    configInfo: void;   // worker-scoped: runs once per worker, not per test
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
    }
});

export { expect } from '@playwright/test'
export { uiEndPoints } from '@constants/endpoint.config.ts'