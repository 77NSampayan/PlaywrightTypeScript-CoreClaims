# src/utils/logger

Structured, colorized console logging for the framework, with automatic Playwright `test.step()` grouping so every logged action also shows up as a collapsible, timed node in the HTML report and trace viewer. `BasePage` and its util classes ([`src/base/`](../../base/README.md)) are built entirely on this — page objects and tests should log through it rather than calling `console.log` directly.

## Files

### `SmartLogger.util.ts` — `SmartLogger`

The core logger. Singleton at the framework level (`export const logger = SmartLogger.getInstance()`), scoped per test via `setTestContext()`. Import the shared instance — never construct one directly (the constructor is private).

**Test lifecycle**

| Method | Purpose |
|---|---|
| `setTestContext(testName)` | Call at the start of each test — resets per-test state and prints a START banner |
| `endTest(passed)` | Call at the end of each test — prints an END banner; if `passed` is `false`, also dumps the last 50 buffered log lines (regardless of `LOG_LEVEL`) so failure context is visible even when running quiet |

Both are already wired up automatically by the `logger` fixture in [`src/fixtures/base.fixture.ts`](../../fixtures/base.fixture.ts) — you don't need to call them yourself in a test.

**Logging**

| Method | Purpose |
|---|---|
| `debug(message)` / `info(message)` / `warn(message)` | Plain log lines at the given level |
| `error(message, err?)` | Logs at ERROR; if `err` is an `Error`, appends its message and stack |
| `highlight(message)` | Like `info()`, but styled like an action log (magenta, with any `"quoted"` substring bolded) — used for structured key/value dumps like the CONFIG INFO banner |
| `step_log(message)` | Logs at STEP level, for step-level messages outside of `step()` |
| `step(stepName, fn)` | Wraps `fn` in a named step: prints a step header, then runs `fn` inside a boxed `test.step()` so it groups in the report/trace viewer |
| `action(startMessage, fn, passMessage, failMessage, level?)` | The core primitive — logs `[START]`, runs `fn` inside a boxed `test.step()`, then logs an `[END]` line and rethrows on error. The success line goes out at the call's own level, the failure line always at `ERROR` — so a red `[ERROR]` tag is what marks a failure, not a separate status tag. `passMessage` may be a function of the result for messages only known after `fn` runs. Defaults to `LogLevel.INFO`; almost every method on `ElementActions`/`ElementAssertions`/`BasePage` is a thin wrapper around this |

**Configuration**

- `setLevel(level)` — override the active log level at runtime (e.g. from a CLI flag)

**Usage**

```ts
import { logger } from '@utils/logger/SmartLogger.util.ts';

await logger.step('Login Flow', async () => {
  await logger.action(
    'Filling username',
    () => page.fill('#user', 'admin'),
    'Username filled',
    'Failed to fill username',
  );
});
```

In practice, most code doesn't call `action()` directly — it's used by `ElementActions`/`ElementAssertions`/`GenericAssertions`/`BasePage`, which take a `SmartLogger` in their constructor. `logger.step(...)` is what tests use directly to group phases (see [`tests/Login.spec.ts`](../../../tests/Login.spec.ts)).

### `LogLevel.util.ts` — `LogLevel`

Defines the severity enum, in ascending order:

```ts
DEBUG = 0, INFO = 1, STEP = 2, WARN = 3, ERROR = 4
```

`resolveLogLevel()` reads the `LOG_LEVEL` env var (case-insensitive) and maps it to a `LogLevel`, defaulting to `INFO` if unset or invalid. Set it in `.env`:

```
LOG_LEVEL=DEBUG   # verbose — shows all messages
LOG_LEVEL=WARN    # quiet — only warnings and errors
```

Messages below the active level are not printed to the console — but they *are* still formatted and written to the circular buffer, so the failure dump in `endTest(false)` genuinely replays them regardless of the active level. The level governs what is **displayed**, never what is **retained**: a run at `LOG_LEVEL=WARN` still gives you full `DEBUG`-level context on a failure.

### `LogFormatter.util.ts` — `LogFormatter`

Pure formatting — ANSI color codes, timestamps, banners. `SmartLogger` calls into this; it holds no state of its own. Change console appearance here, not inline in `SmartLogger`.

| Method | Produces |
|---|---|
| `format({ level, message })` | A single log line: `[HH:MM:SS.mmm] [LEVEL] message` |
| `formatStepHeader(stepName)` | A step separator line: `── STEP: name ──────────` |
| `formatTestBanner(testName, event, passed?)` | The START/END banner block printed by `setTestContext()`/`endTest()` |
| `formatActionStart(message)` | The `[START] message` line opening an `action()` call |
| `formatActionEnd(message)` | The `[END] message` line closing an `action()` call |
| `colorize(message)` | Colors a message magenta and bolds any `"quoted"` substring in place — used by `highlight()` and the action formatters |

Test name and step name are intentionally omitted from `format()` — they're already shown once in the banner/step header, so repeating them on every line would be noise.

## Conventions

- Always log through the shared `logger` singleton, not a new `SmartLogger` instance.
- Prefer `action()` (via the `src/base` wrappers) over raw `info`/`error` calls for anything that performs a Playwright action or assertion — it gives you START/END logging, automatic ERROR-level escalation on failure, and a trace-viewer step for one call.
- Keep sensitive values out of log messages, and remember that every `action()` start message is reused as the `test.step()` name — so anything interpolated into one reaches the HTML report and the trace, not just the console. For form input, pass `{ mask: true }` to `ElementActions.fill()`; and never interpolate a credential or account identifier into a `logger.step()` label.
