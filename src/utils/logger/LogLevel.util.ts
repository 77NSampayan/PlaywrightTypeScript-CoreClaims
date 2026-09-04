// ─────────────────────────────────────────────
//  LogLevel.ts
//  Defines log severity levels and active level
//  driven by the LOG_LEVEL environment variable.
// ─────────────────────────────────────────────

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  STEP = 2,
  WARN = 3,
  ERROR = 4,
};

/**
 * Maps string env values to LogLevel enum.
 * Defaults to INFO if LOG_LEVEL is not set or invalid.
 *
 * Usage in .env or CI:
 *   LOG_LEVEL=DEBUG   → verbose, shows all messages
 *   LOG_LEVEL=WARN    → quiet, shows only warnings and errors
 */
export function resolveLogLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'INFO').toUpperCase();
  const map: Record<string, LogLevel> = {
    DEBUG: LogLevel.DEBUG,
    INFO: LogLevel.INFO,
    STEP: LogLevel.STEP,
    WARN: LogLevel.WARN,
    ERROR: LogLevel.ERROR,
  };
  return map[raw] ?? LogLevel.INFO;
};