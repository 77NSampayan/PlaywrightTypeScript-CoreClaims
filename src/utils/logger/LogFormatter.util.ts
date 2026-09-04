// ─────────────────────────────────────────────
//  LogFormatter.ts
//  Handles ANSI color-coding, timestamps, and
//  structured message layout for console output.
// ─────────────────────────────────────────────

import { LogLevel } from './LogLevel.util.ts';

// ANSI escape codes — safe to use in Node/Playwright runners
const ANSI = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  unbold:  '\x1b[22m',   // cancels bold only — leaves an active color untouched
  dim:     '\x1b[2m',

  // Level colors
  debug:   '\x1b[36m',   // Cyan
  info:    '\x1b[32m',   // Green
  step:    '\x1b[34m',   // Blue
  warn:    '\x1b[33m',   // Yellow
  error:   '\x1b[31m',   // Red

  // Action lifecycle tag colors
  start:   '\x1b[96m',   // Bright Cyan
  end:     '\x1b[94m',   // Bright Blue

  // Action message color
  action:  '\x1b[35m',   // Magenta

  // Context colors
  test:    '\x1b[35m',   // Magenta
  time:    '\x1b[90m',   // Gray
};

/** Renders `[word]` bold, with color optional — brackets always stay plain. */
function tag(word: string, color?: string): string {
  return `[${color ?? ''}${ANSI.bold}${word}${ANSI.reset}]`;
}

/** Same as tag(), but pads short words so level labels line up in a fixed-width column. */
function levelTag(word: string, color: string): string {
  return word.length < 5 ? `${tag(word, color)} ` : tag(word, color);
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: levelTag('DEBUG', ANSI.debug),
  [LogLevel.INFO]:  levelTag('INFO', ANSI.info),
  [LogLevel.STEP]:  levelTag('STEP', ANSI.step),
  [LogLevel.WARN]:  levelTag('WARN', ANSI.warn),
  [LogLevel.ERROR]: levelTag('ERROR', ANSI.error),
};

export interface FormatOptions {
  level: LogLevel;
  message: string;
}

export class LogFormatter {
  /**
   * Formats a single log line for console output.
   * Test name and step name are intentionally omitted — they're already
   * shown once in the START/END banner and STEP header, so repeating them
   * on every line would just be noise.
   *
   * Example output:
   *   [12:30:45.123] [INFO]  >> Enter credentials
   *   [12:30:45.200] [ERROR] >> Assertion failed
   */
  static format({ level, message }: FormatOptions): string {
    const timestamp = this.timestamp();
    const label = LEVEL_LABELS[level];

    return `${ANSI.time}[${timestamp}]${ANSI.reset} ${label} ${message}`;
  }

  /**
   * Formats a step separator line — visually distinct in the console.
   *
   * Example output:
   *   ── STEP: Login Flow ──────────────────────
   */
  static formatStepHeader(stepName: string): string {
    const line = '─'.repeat(Math.max(0, 48 - stepName.length - 9));
    return `${ANSI.step}── STEP: ${ANSI.bold}${stepName}${ANSI.reset}${ANSI.step} ${line}${ANSI.reset}`;
  }

  /**
   * Formats a test lifecycle banner (start/end).
   */
  static formatTestBanner(testName: string, event: 'START' | 'END', passed?: boolean): string {
    const icon  = event === 'START' ? '▶' : passed ? '✔' : '✘';
    const color = event === 'START' ? ANSI.test : passed ? ANSI.info : ANSI.error;
    const bar   = '═'.repeat(52);
    return `\n${color}${bar}\n${icon}  ${event}: ${testName}\n${bar}${ANSI.reset}\n`;
  }

  /**
   * Formats the `[START] <message>` line that opens a logger.action() call.
   * The message is colored magenta, with any `"quoted"` substring bolded.
   */
  static formatActionStart(message: string): string {
    return `${tag('START', ANSI.start)} ${this.colorize(message)}`;
  }

  /**
   * Formats the `[END] [PASSED|FAILED] <message>` line that closes a
   * logger.action() call. Both tags are bold; PASSED stays uncolored
   * (default), FAILED colors only that word red — the message itself
   * stays magenta either way.
   */
  static formatActionEnd(status: 'PASSED' | 'FAILED', message: string): string {
    const statusColor = status === 'FAILED' ? ANSI.error : undefined;
    // return `${tag('END', ANSI.end)} ${tag(status, statusColor)} ${this.colorize(message)}`;
    return `${tag('END', ANSI.end)} ${this.colorize(message)}`;
  }

  // ─── Helpers ──────────────────────────────

  private static timestamp(): string {
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    const ss  = String(now.getSeconds()).padStart(2, '0');
    const ms  = String(now.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  /**
   * Colors a message magenta, bolding any `"quoted"` substring in place
   * (via unbold, not a full reset, so the magenta keeps going after the
   * bold segment ends). Used by action logs and by `logger.highlight()`.
   */
  static colorize(message: string): string {
    const bolded = message.replace(/"([^"]*)"/g, (_match, inner) => `"${ANSI.bold}${inner}${ANSI.unbold}"`);
    return `${ANSI.action}${bolded}${ANSI.reset}`;
  }
}