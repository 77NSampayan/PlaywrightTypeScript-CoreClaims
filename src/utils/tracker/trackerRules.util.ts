// ─────────────────────────────────────────────
//  trackerRules.util.ts
//  The Control Code Tracker's gating rules, as pure
//  functions over one row: "may this stage run for
//  this code now?" and "what should the Control
//  columns say?". No file I/O here, so the rules can
//  be exercised directly by ControlCodeTracker.spec.ts
//  without a workbook.
// ─────────────────────────────────────────────

import {
    STAGES,
    STAGE_COLUMNS,
    STAGE_STATUSES,
    STALE_IN_PROGRESS_MINUTES,
    isWaitStage,
    writerFor,
    type OverallStatus,
    type PaymentChannel,
    type Stage,
    type StageStatus,
    type TrackerColumnKey,
    type WaitStage,
    type WaitWindow,
} from '../../constants/tracker.config.ts';

export type CellValue = string | number | Date | undefined;
export type TrackerRow = Partial<Record<TrackerColumnKey, CellValue>>;
export type WaitConfig = Record<WaitStage, WaitWindow>;

// ─── Timestamps ──────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Local wall-clock text ("2026-10-26 10:15:00"), not a native Excel date:
 * ExcelJS writes a JS Date as its UTC value, so a native date cell would show
 * the time 8 hours off in Manila. Text round-trips exactly and still sorts.
 */
export function formatTimestamp(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatClock(date: Date): string {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Accepts our own text form, or a native date cell — e.g. after someone
 * retypes a timestamp by hand and Excel converts it. ExcelJS hands those
 * back as the wall-clock time expressed in UTC, so the UTC fields are read
 * back as local ones.
 */
export function parseTimestamp(value: CellValue): Date | undefined {
    if (value instanceof Date) {
        return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(),
            value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds());
    }
    if (typeof value !== 'string') return undefined;

    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!match) return undefined;
    const [, y, mo, d, h, mi, s] = match;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
}

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

// ─── Row accessors ──────────────────────────────

/**
 * Blank reads as NOT_STARTED. Anything else that isn't a known status (a
 * hand-typed typo) comes back as 'INVALID', which no stage treats as
 * eligible — guessing would risk re-uploading a code.
 */
export function getStatus(row: TrackerRow, stage: Stage): StageStatus | 'INVALID' {
    const raw = row[STAGE_COLUMNS[stage].status];
    if (raw === undefined || String(raw).trim() === '') return 'NOT_STARTED';

    const normalized = String(raw).trim().toUpperCase();
    return (STAGE_STATUSES as readonly string[]).includes(normalized) ? (normalized as StageStatus) : 'INVALID';
}

export function getAt(row: TrackerRow, stage: Stage): Date | undefined {
    return parseTimestamp(row[STAGE_COLUMNS[stage].at]);
}

export function getChannel(row: TrackerRow): PaymentChannel | undefined {
    const raw = String(row.paymentChannel ?? '').trim().toUpperCase();
    return raw === 'DPS' || raw === 'UB' || raw === 'COMCHECK' ? raw : undefined;
}

const isDone = (status: StageStatus | 'INVALID') => status === 'PASSED' || status === 'N/A';

// ─── Wait windows ──────────────────────────────

export type WaitWindowTimes = { start: Date; nextCheckAt: Date; deadline: Date };

/**
 * A wait's window opens when the stage before it finished — the upload, or
 * the previous signal (swimlane "Waiting rules"). N/A stages are skipped, so
 * for an all-"N" code S3's window opens at S1, not at the memo upload.
 */
export function waitWindow(row: TrackerRow, stage: WaitStage, config: WaitConfig): WaitWindowTimes | undefined {
    const index = STAGES.indexOf(stage);
    for (let i = index - 1; i >= 0; i--) {
        const previous = STAGES[i]!;
        if (getStatus(row, previous) === 'N/A') continue;

        const start = getAt(row, previous);
        if (!start) return undefined;
        const { minWaitMinutes, capMinutes } = config[stage];
        return { start, nextCheckAt: addMinutes(start, minWaitMinutes), deadline: addMinutes(start, capMinutes) };
    }
    return undefined;
}

// ─── Eligibility ──────────────────────────────

export type Evaluation =
    | { state: 'ELIGIBLE'; overdue: boolean; window?: WaitWindowTimes }
    | { state: 'NOT_DUE'; window: WaitWindowTimes }
    | { state: 'INELIGIBLE'; reason: string };

export function evaluateStage(row: TrackerRow, stage: Stage, config: WaitConfig, now: Date): Evaluation {
    const index = STAGES.indexOf(stage);
    for (const earlier of STAGES.slice(0, index)) {
        const earlierStatus = getStatus(row, earlier);
        if (!isDone(earlierStatus)) {
            return { state: 'INELIGIBLE', reason: `waiting on ${earlier} (${earlierStatus})` };
        }
    }

    // A code that has ended (a later stage timed out or isn't covered) is not
    // re-entered just because someone cleared an earlier stage by hand — the
    // ending status has to be cleared too, deliberately.
    for (const later of STAGES.slice(index + 1)) {
        const laterStatus = getStatus(row, later);
        if (laterStatus === 'TIMED_OUT' || laterStatus === 'NOT_COVERED') {
            return { state: 'INELIGIBLE', reason: `code ended at ${later} (${laterStatus}) — clear that status to retry` };
        }
    }

    const status = getStatus(row, stage);
    switch (status) {
        case 'PASSED':
        case 'N/A':
        case 'NOT_COVERED':
        case 'TIMED_OUT':
        case 'BLOCKED':
            return { state: 'INELIGIBLE', reason: `already ${status}` };
        case 'INVALID':
            return { state: 'INELIGIBLE', reason: `unrecognised status "${String(row[STAGE_COLUMNS[stage].status])}"` };
        case 'IN_PROGRESS': {
            const startedAt = getAt(row, stage);
            if (startedAt && now.getTime() - startedAt.getTime() < STALE_IN_PROGRESS_MINUTES * 60_000) {
                return { state: 'INELIGIBLE', reason: `in progress since ${formatClock(startedAt)}` };
            }
            break; // stale — a crashed run; eligible again
        }
        case 'NOT_STARTED':
        case 'WAITING':
        case 'FAILED':
            break;
    }

    if (!isWaitStage(stage)) return { state: 'ELIGIBLE', overdue: false };

    const window = waitWindow(row, stage, config);
    if (!window) return { state: 'INELIGIBLE', reason: 'previous stage has no timestamp to open the wait window from' };
    if (now < window.nextCheckAt) return { state: 'NOT_DUE', window };
    return { state: 'ELIGIBLE', overdue: now >= window.deadline, window };
}

// ─── Control columns ──────────────────────────────

export type ControlColumns = Pick<
    TrackerRow,
    'currentStage' | 'currentStatus' | 'nextStep' | 'waitWindowStart' | 'nextCheckAt' | 'waitDeadline' | 'overallStatus'
>;

function overallStatusOf(row: TrackerRow): OverallStatus {
    const statuses = STAGES.map((stage) => getStatus(row, stage));
    if (statuses.includes('TIMED_OUT')) return 'MANUAL_INVESTIGATION';
    if (statuses.includes('NOT_COVERED')) return 'ENDED_NOT_COVERED';
    if (statuses.includes('FAILED') || statuses.includes('INVALID')) return 'FAILED';
    if (statuses.every(isDone)) return 'PASSED';
    return 'IN_FLIGHT';
}

/** Recomputed for every row on every write — never trust what was there before. */
export function deriveControl(row: TrackerRow, config: WaitConfig, now: Date): ControlColumns {
    const current = STAGES.find((stage) => !isDone(getStatus(row, stage)));
    const overallStatus = overallStatusOf(row);
    const blank = { waitWindowStart: undefined, nextCheckAt: undefined, waitDeadline: undefined };

    if (!current) {
        return { currentStage: 'COMPLETE', currentStatus: 'PASSED', nextStep: 'None — all stages passed', overallStatus, ...blank };
    }

    const status = getStatus(row, current);
    const writer = writerFor(current, getChannel(row));
    const base = { currentStage: current, currentStatus: status, overallStatus };

    switch (status) {
        case 'TIMED_OUT':
            return { ...base, ...blank, nextStep: 'Manual investigation — see Event Log. Never retried automatically.' };
        case 'NOT_COVERED':
            return { ...base, ...blank, nextStep: "None — not carried by the channel's Return File" };
        case 'BLOCKED':
            return { ...base, ...blank, nextStep: 'Blocked by an earlier timeout' };
        case 'INVALID':
            return { ...base, ...blank, nextStep: `Fix the ${current} status by hand (unrecognised value)` };
        case 'IN_PROGRESS': {
            const startedAt = getAt(row, current);
            return { ...base, ...blank, nextStep: `${writer} is running${startedAt ? ` (since ${formatClock(startedAt)})` : ''}` };
        }
        case 'FAILED':
            return { ...base, ...blank, nextStep: `Re-run ${writer} (retryable)` };
        case 'NOT_STARTED':
        case 'WAITING':
        case 'PASSED':
        case 'N/A':
            break;
    }

    if (!isWaitStage(current)) return { ...base, ...blank, nextStep: `Run ${writer}` };

    const window = waitWindow(row, current, config);
    if (!window) return { ...base, ...blank, nextStep: `Run ${writer}` };

    const timing = now < window.nextCheckAt
        ? `after ${formatClock(window.nextCheckAt)}`
        : `now (deadline ${formatClock(window.deadline)})`;
    return {
        ...base,
        nextStep: `Run ${writer} ${timing}`,
        waitWindowStart: formatTimestamp(window.start),
        nextCheckAt: formatTimestamp(window.nextCheckAt),
        waitDeadline: formatTimestamp(window.deadline),
    };
}
