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

export type TestAccount = {
  readonly username: string;
  readonly password: string;
  readonly otpSecret: string;
};

function accountFromEnv(n: number): TestAccount {
  return {
    username: requireEnv(`VALID_USERNAME_${n}`),
    password: requireEnv(`VALID_PASSWORD_${n}`),
    // Getter, not a plain property: playwright.config.ts is evaluated for every
    // `npx playwright test` invocation, so an eager requireEnv() here would break
    // commands that never touch the TOTP flow — e.g. the `db` project, or a
    // `--no-deps` run that reuses an already-saved session instead of signing in.
    // Deferring the check to first access keeps the fail-loud behavior for
    // whichever test actually reads it, without punishing every other run.
    get otpSecret(): string {
      return requireEnv(`VALID_OTP_SECRET_${n}`);
    },
  };
}

// The Microsoft SSO test accounts, one per parallel worker: `workers` below is
// set to this length, and base.fixture.ts binds worker N to test_accounts[N]
// (via parallelIndex) along with its own saved session, storageStateFor(N).
// Account 1 is required; _2, _3, ... are picked up while VALID_USERNAME_n is
// set, stopping at the first gap — so a .env holding only your own account
// still runs, just on one worker.
export const test_accounts: TestAccount[] = [accountFromEnv(1)];
for (let n = 2; process.env[`VALID_USERNAME_${n}`]; n++) {
  test_accounts.push(accountFromEnv(n));
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

// Azure Blob Storage SAS URL for the claims intake pipeline (writes to a real
// production container) — lazy getter, same reasoning as db_config above:
// only IntakeUpload.spec.ts touches this, so an eager requireEnv() here would
// break every run that doesn't. This is a live, time-limited WRITE credential
// (the SAS's own `se=` param expires it) — never log it, never commit it.
export const intake_blob_config = {
  get sasUrl(): string {
    return requireEnv('INTAKE_BLOB_SAS_URL');
  },
};

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
  // One worker per test account, locally and on CI. This cap is what keeps two
  // workers from ever signing in as the same account at once (see
  // test_accounts above) — to run more workers, add accounts, don't raise this.
  workers: test_accounts.length,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    // Explicit terminal reporter. Without one, Playwright adds its `line`
    // reporter, whose live progress line (test › step › action) prints as a
    // new line per step wherever the output can't redraw in place (VS Code's
    // output panes, CI logs), burying SmartLogger's lines under duplicates.
    // `list` prints one line per finished test and passes our logs through as-is.
    ['list'],
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
    // Attach a final-state screenshot to the report only when a test fails. Playwright
    // attaches it to the test result, and the allure-playwright reporter above maps that
    // into the Allure report too — so it shows up in BOTH the HTML and Allure reports with
    // no extra code. A single frame, so its PII footprint is far smaller than a trace.
    screenshot: 'only-on-failure',
    // Traces locally, NEVER in CI. A trace bundles full DOM snapshots and network payloads
    // of authenticated claim/member pages — the richest PII artifact — and both CI pipelines
    // upload the reports (see .github/workflows/playwright.yml, azure-pipelines.yml), so a CI
    // trace would publish that PII into a shared artifact (the exposure once closed in
    // .claude/review-tracking/main.md:26). Off in CI by design; `retain-on-failure` locally
    // gives a trace on the first failure without needing a retry (local `retries: 0`).
    // See https://playwright.dev/docs/trace-viewer
    trace: process.env.CI ? 'off' : 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    // DB-backed specs (Database.spec.ts) touch no page/browser — running them
    // here, and excluding them from the browser projects below via
    // testIgnore, means one run of each query instead of three, and no
    // browser launch just to print the configInfo banner. Same for the
    // Control Code Tracker's DE wait checks (PipelineSignalCheck.spec.ts) and
    // the tracker's own rules spec (ControlCodeTracker.spec.ts — no DB either).
    {
      name: 'db',
      testMatch: /(Database|PipelineSignalCheck|ControlCodeTracker)\.spec\.ts/,
    },

    // Signs in each test account ONCE (password + generated TOTP) and saves its
    // session to storageStateFor(index); `api` and `msedge` depend on it and
    // start every test already signed in as their worker's account (the
    // `storageState` override in base.fixture.ts). One live MFA sign-in per
    // account per run, however many tests — repeat sign-ins of one account would
    // otherwise submit the same single-use OTP code within one 30s window, and
    // Microsoft rejects the repeat. Different accounts have different TOTP
    // secrets, so their setups can safely run in parallel.
    // Skip it with `--no-deps` to reuse a still-valid session from a prior run.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
      },
    },

    // Same reasoning as the `db` project above: these specs open the Azure
    // Portal in a browser to mint a SAS, but their actual upload is a plain
    // HTTP call (Azure Blob), not Core Claims page objects. Kept as their own
    // project rather than folded into `db` since it's a different kind of
    // external dependency (a live, time-limited SAS credential against a real
    // production endpoint, not a database connection).
    {
      name: 'api',
      testMatch: /(IntakeUpload|ClaimMemoUpload|PaymentJournalUpload|F2307Upload|ReturnFileUpload)\.spec\.ts/,
      dependencies: ['setup'],
    },

    // Session-reuse check against Outlook on the web (tests/test.auth.spec.ts).
    // Its own project (and excluded from msedge below) so it runs once, alone.
    // Gated by AUTH_SPIKE inside the spec so a plain full run doesn't spend an
    // extra live MFA sign-in on it.
    {
      name: 'auth',
      testMatch: /test\.auth\.spec\.ts/,
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
      },
    },

    {
      name: 'msedge',
      testIgnore: /(Database|PipelineSignalCheck|ControlCodeTracker|IntakeUpload|ClaimMemoUpload|PaymentJournalUpload|F2307Upload|ReturnFileUpload|test\.auth)\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
        //viewport: null, //Bypass Playwright's default 1280x720 resolution
      },
    },

    // {
    //   name: 'firefox',
    //   testIgnore: /(Database|PipelineSignalCheck|ControlCodeTracker|IntakeUpload|ClaimMemoUpload|PaymentJournalUpload|F2307Upload|ReturnFileUpload|test\.auth)\.spec\.ts/,
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   testIgnore: /(Database|PipelineSignalCheck|ControlCodeTracker|IntakeUpload|ClaimMemoUpload|PaymentJournalUpload|F2307Upload|ReturnFileUpload|test\.auth)\.spec\.ts/,
    //   use: { ...devices['Desktop Safari'] },
    // },

    // {
    //   name: 'chrome',
    //   testIgnore: /(Database|PipelineSignalCheck|ControlCodeTracker|IntakeUpload|ClaimMemoUpload|PaymentJournalUpload|F2307Upload|ReturnFileUpload|test\.auth)\.spec\.ts/,
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
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
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
