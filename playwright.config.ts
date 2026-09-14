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

// Getters, not plain properties — same reasoning as valid_otp_secret_1 above:
// only DB-backed specs need these, so an eager requireEnv() here would break
// every UI-only run for a config value it never touches.
export const db_config = {
  get server(): string {
    return requireEnv('DB_SERVER');
  },
  get database(): string {
    return requireEnv('DB_NAME');
  },
  get user(): string {
    return requireEnv('DB_USER');
  },
  get password(): string {
    return requireEnv('DB_PASSWORD');
  },
  get port(): number {
    return Number(process.env.DB_PORT ?? 1433);
  },
}

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
    baseURL: process.env.BASE_URL,
    headless: false,
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
    {
      name: 'chromium',
      use: { 
        viewport: null, //Bypass Playwright's default 1280x720 resolution
        },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
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
