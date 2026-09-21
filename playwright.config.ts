import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
dotenv.config({ path: path.resolve(__dirname, '.env') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Check your .env file.`);
  }
  return value;
}

export const test_credentials = {
  valid_username_1: requireEnv('VALID_USERNAME_1'),
  valid_password_1: requireEnv('VALID_PASSWORD_1'),
  // Getter, not a plain property: playwright.config.ts is evaluated for every
  // `npx playwright test` invocation, so an eager requireEnv() here would break
  // commands that never touch the TOTP flow — e.g. the session-reuse spikes in
  // AUTHENTICATION.md, which exist specifically to avoid needing this secret.
  // Deferring the check to first access keeps the fail-loud behavior for
  // whichever test actually reads it, without punishing every other run.
  get valid_otp_secret_1(): string {
    return requireEnv('VALID_OTP_SECRET_1');
  },
}

// `??` only catches null/undefined, so `FOO_PORT=` (present but empty — an easy
// state after `cp .env.example .env`) would silently become port 0 rather than
// falling back. Treat empty the same way requireEnv() does: not there.
function optionalPort(name: string, defaultPort: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultPort;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid ${name}: "${raw}". Expected a positive port number.`);
  }
  return port;
}

// Getters, not plain properties — same reasoning as valid_otp_secret_1 above:
// only DB-backed specs need these, so an eager requireEnv() here would break
// every UI-only run for a config value it never touches.
function dbConfigFromEnv(prefix: string) {
  return {
    get server(): string {
      return requireEnv(`${prefix}_SERVER`);
    },
    get database(): string {
      return requireEnv(`${prefix}_NAME`);
    },
    get user(): string {
      return requireEnv(`${prefix}_USER`);
    },
    get password(): string {
      return requireEnv(`${prefix}_PASSWORD`);
    },
    get port(): number {
      return optionalPort(`${prefix}_PORT`, 1433);
    },
  };
}

// Pre-production — data_enrichment
export const db_config = dbConfigFromEnv('DATA_ENRICHMENT_DB');

// Membership database — separate server/credentials from db_config above.
export const membership_db_config = dbConfigFromEnv('MEMBERSHIP_DB');

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },

  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  ...(process.env.CI ? { workers: 1 } : {}),
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['allure-playwright', {
      resultsDir: 'allure-results',
      detail: true,
      suiteTitle: false,
    }],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    actionTimeout: 10_000,
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: requireEnv('BASE_URL'),
    // Headed locally by design (see README); CI runners have no display, so
    // force headless there rather than failing to launch.
    headless: !!process.env.CI,
    // preprod/UAT (e.g. preprod.app.coreclaims.amplifyhealth.com, reached from a
    // portal app card) serves a self-signed/internal-CA cert Chromium doesn't trust.
    // Only acceptable because this targets non-production environments.
    ignoreHTTPSErrors: true,
    javaScriptEnabled: true,
    launchOptions: {
      args: ['--start-maximized'], // Tells browser to open maximized
    },
    navigationTimeout: 15_000,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    // DB-backed specs (Database.spec.ts) touch no page/browser — running them
    // here, and excluding them from the browser projects below via
    // testIgnore, means one run of each query instead of three, and no
    // browser launch just to print the configInfo banner.
    {
      name: 'db',
      testMatch: /Database\.spec\.ts/,
    },

    {
      name: 'msedge',
      testIgnore: /Database\.spec\.ts/,
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
       // viewport: null, //Bypass Playwright's default 1280x720 resolution
      },
    },

    // {
    //   name: 'firefox',
    //   testIgnore: /Database\.spec\.ts/,
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   testIgnore: /Database\.spec\.ts/,
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against other browsers. */
    // {
    //   name: 'chromium',
    //   use: { viewport: null },
    // },
    // {
    //   name: 'chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
