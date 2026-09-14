import { test as base } from '@playwright/test';
// import { AuthenticationAPI } from '../../api/authentication/authentication-api.ts';
import { logger, type SmartLogger } from '@utils/logger/SmartLogger.util.ts';
import { DbConnection, SqliteWasmConnection } from '@utils/db.util.ts';
import { LoginPage } from '@pages/login.page.ts';
import { MicrosoftLoginPage } from '@pages/microsoft-login.page.ts';


export type TestFixtures = {
    // authentication: AuthenticationAPI;
    logger: SmartLogger;
    loginPage: LoginPage;
    microsoftLoginPage: MicrosoftLoginPage;
    dbConnection: DbConnection;
    sqliteConnection: SqliteWasmConnection;
};

export type WorkerFixtures = {
    configInfo: void;   // worker-scoped: runs once per worker, not per test
}

export const test = base.extend<TestFixtures, WorkerFixtures>({

    // ── Worker-scoped: logs config once at the start of each worker ──
    configInfo: [async ({ browser }, use, workerInfo) => {

        // ─────────────────────────────────────────────────────
        //  Runs once before the entire test suite.
        //  Logs active configuration so it appears at
        //  the top of every test run output for verification.
 
        await logger.setTestContext('CONFIG INFO');
 
        await logger.step('PLAYWRIGHT CONFIGURATION', async () => {
            logger.highlight(`Browser            : "${browser.browserType().name()}"`);
            logger.highlight(`Worker index       : "${workerInfo.workerIndex}"`);
            logger.highlight(`Parallel index     : "${workerInfo.parallelIndex}"`);
        });

        await logger.step('ENVIRONMENT', async () => {
            logger.highlight(`BASE_URL           : "${process.env.BASE_URL ?? 'not set — using default'}"`);
            logger.highlight(`LOG_LEVEL          : "${process.env.LOG_LEVEL ?? 'INFO (default)'}"`);
            logger.highlight(`Node version       : "${process.version}"`);
            logger.highlight(`Platform           : "${process.platform}"`);
        });
 
        await logger.endTest(true);
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
        await logger.setTestContext(testInfo.title);

        await use(logger);

        // Fires after each test - prints END baner; dumps buffer on failure
        const passed = await testInfo.status == testInfo.expectedStatus;
        await logger.endTest(passed);
    },

    // ── Test-scoped: page object ──────────────────────────────────
    loginPage: async ({ page }, use) => {
        await use(new LoginPage(page));
    },

    microsoftLoginPage: async ({ page }, use) => {
        await use(new MicrosoftLoginPage(page));
    },

    // ── Test-scoped: DB connection, opened/closed around the test ──
    dbConnection: async ({}, use) => {
        const dbConnection = new DbConnection();
        await dbConnection.connect();
        await use(dbConnection);
        await dbConnection.close();
    },

    // ── Test-scoped: in-process SQLite Wasm DB, pre-seeded and ready by the time the test body runs ──
    sqliteConnection: async ({}, use) => {
        const sqliteConnection = new SqliteWasmConnection();
        await sqliteConnection.connect();
        await sqliteConnection.seedClaimsTable();
        await use(sqliteConnection);
        await sqliteConnection.close();
    }
});

export { expect } from '@playwright/test'
export { uiEndPoints } from '@constants/endpoint.config.ts'