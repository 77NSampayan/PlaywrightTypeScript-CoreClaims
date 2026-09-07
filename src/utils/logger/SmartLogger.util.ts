// ─────────────────────────────────────────────
//  SmartLogger.ts
//  Core logger class. Singleton at framework level,
//  scoped per test via setTestContext().
// ─────────────────────────────────────────────

import { test } from '@playwright/test';
import { LogLevel, resolveLogLevel } from './LogLevel.util.ts';
import { LogFormatter } from './LogFormatter.util.ts';

export class SmartLogger {
  // ─── Singleton ────────────────────────────
  private static _instance: SmartLogger;

  static getInstance(): SmartLogger {
    if (!SmartLogger._instance) {
      SmartLogger._instance = new SmartLogger();
    }
    return SmartLogger._instance;
  }

  // ─── State ────────────────────────────────
  private activeLevel: LogLevel = resolveLogLevel();
  private testName: string | undefined = undefined;

  // Circular buffer: keeps the last N log lines for failure dumps
  private readonly BUFFER_SIZE = 50;
  private logBuffer: string[] = [];

  private constructor() {}

  // ─── Test Lifecycle ───────────────────────

  /**
   * Call at the start of each test (e.g., in beforeEach or a fixture).
   * Resets per-test state so logs don't bleed between tests.
   */
  setTestContext(testName: string): void {
    this.testName  = testName;
    this.logBuffer = [];
    console.log(LogFormatter.formatTestBanner(testName, 'START'));
  }

  /**
   * Call at the end of each test. Prints a summary banner.
   * Pass `passed: false` to also dump the recent log buffer.
   */
  endTest(passed: boolean): void {
    if (!passed) {
      this.dumpBuffer();
    }
    console.log(LogFormatter.formatTestBanner(this.testName ?? 'Unknown Test', 'END', passed));
    this.testName = undefined;
  }

  // ─── Step Context ─────────────────────────

  /**
   * Wraps an async block in a named step, printing a STEP header
   * before it runs. Logs inside no longer repeat the step name —
   * the header already provides that separation.
   *
   * Also opens a real Playwright `test.step()` (boxed) around `fn`, so the
   * same grouping shows up as a collapsible, timed node in the HTML report
   * and trace viewer — not just in the console.
   *
   * @example
   * await logger.step('Login Flow', async () => {
   *   await logger.info('Filling username');
   *   await page.fill('#user', 'admin');
   * });
   */
  async step<T>(stepName: string, fn: () => Promise<T>): Promise<T> {
    console.log(LogFormatter.formatStepHeader(stepName));
    return this.runStep(stepName, fn);
  }

  // ─── Log Methods ──────────────────────────

  debug(message: string): void {
    this.emit(LogLevel.DEBUG, message);
  }

  info(message: string): void {
    this.emit(LogLevel.INFO, message);
  }

  /**
   * Same as info(), but styled like an action log — the message is
   * magenta, with any `"quoted"` value bolded. Use for structured
   * key/value dumps (e.g. the CONFIG INFO banner) where a value should
   * stand out.
   */
  highlight(message: string): void {
    this.emit(LogLevel.INFO, LogFormatter.colorize(message));
  }

  /** Use for explicit step-level messages outside of the step() wrapper. */
  step_log(message: string): void {
    this.emit(LogLevel.STEP, message);
  }

  /**
   * Wraps a single Playwright action or assertion with START/END logging.
   * Logs `[START] <startMessage>`, runs `fn`, then logs
   * `[END] <passMessage>` on success or `[END] <failMessage>` on failure.
   * The failure line is always emitted at ERROR level — red, and never hidden
   * by LOG_LEVEL — which is what distinguishes it from the success line. Then
   * rethrows, so the caller/Playwright still sees the original error.
   *
   * `passMessage` may be a function of the result, for messages that depend
   * on state only known after `fn` runs (e.g. the page URL after a navigation).
   *
   * @example
   * await logger.action(
   *   `Asserting element "${description}" visibility`,
   *   () => expect(locator).toBeVisible(options),
   *   `Element "${description}" is visible!`,
   *   `Element "${description}" is not visible!`,
   * );
   */
  async action<T>(
    startMessage: string,
    fn: () => Promise<T> | T,
    passMessage: string | ((result: T) => string),
    failMessage: string,
    level: LogLevel = LogLevel.INFO,
  ): Promise<T> {
    this.emit(level, LogFormatter.formatActionStart(startMessage));
    return this.runStep(startMessage, async () => {
      try {
        const result = await fn();
        const pass = typeof passMessage === 'function' ? passMessage(result) : passMessage;
        this.emit(level, LogFormatter.formatActionEnd(pass));
        return result;
      } catch (err) {
        this.emit(LogLevel.ERROR, LogFormatter.formatActionEnd(failMessage));
        throw err;
      }
    });
  }

  warn(message: string): void {
    this.emit(LogLevel.WARN, message);
  }

  error(message: string, err?: unknown): void {
    const suffix = err instanceof Error
      ? `\n  → ${err.message}${err.stack ? `\n${err.stack}` : ''}`
      : err ? `\n  → ${String(err)}` : '';
    this.emit(LogLevel.ERROR, message + suffix);
  }

  // ─── Configuration ────────────────────────

  /** Override the active log level at runtime (e.g., from a CLI flag). */
  setLevel(level: LogLevel): void {
    this.activeLevel = level;
  }

  // ─── Internals ────────────────────────────

  /**
   * Central emit — all log methods funnel through here.
   * Skips output if the message level is below the active threshold.
   * Stores every emitted line in the circular buffer.
   *
   * Future integration points:
   *   → Add Allure attachment call here
   *   → Add Playwright test.info().attach() call here
   *   → Add file-write call here
   */
  private emit(level: LogLevel, message: string): void {
    if (level < this.activeLevel) return;

    const formatted = LogFormatter.format({ level, message });

    console.log(formatted);
    this.bufferLine(formatted);
  }

  /**
   * Opens a real Playwright `test.step()` (boxed, so a failure is reported
   * at the caller's call site) around `fn`, giving it a matching entry in
   * the HTML report and trace viewer. Falls back to plainly calling `fn()`
   * when there's no test currently running (e.g. a worker-scoped fixture
   * running outside any single test) — `test.step()` requires an active
   * test, `test.info()` is the standard way to check for one without side
   * effects, checked *before* `fn` runs so it's never invoked twice.
   */
  private async runStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
    let inTest = true;
    try {
      test.info();
    } catch {
      inTest = false;
    }

    return inTest
      ? test.step(name, fn, { box: true })
      : fn();
  }

  /** Keeps the circular buffer within BUFFER_SIZE. */
  private bufferLine(line: string): void {
    this.logBuffer.push(line);
    if (this.logBuffer.length > this.BUFFER_SIZE) {
      this.logBuffer.shift();
    }
  }

  /**
   * Dumps the last N buffered lines to console on test failure.
   * Useful for seeing context without re-running with verbose logging.
   */
  private dumpBuffer(): void {
    console.log('\n\x1b[31m── Last logs before failure ──────────────\x1b[0m');
    this.logBuffer.forEach(line => console.log(line));
    console.log('\x1b[31m──────────────────────────────────────────\x1b[0m\n');
  }
}

// Export a ready-to-use singleton reference
export const logger = SmartLogger.getInstance();