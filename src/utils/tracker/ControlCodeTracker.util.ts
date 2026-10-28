// ─────────────────────────────────────────────
//  ControlCodeTracker.util.ts
//  The Control Code Tracker workbook as an API:
//  specs ask it which control codes a stage may
//  process right now, and report back when a stage
//  starts, passes, fails, keeps waiting or times out.
//
//  Deliberately has no SmartLogger dependency, same
//  as blobUpload.util.ts: scripts/init-control-code-
//  tracker.ts uses it outside any Playwright test,
//  where logger.action()'s test.step() would throw.
//  Specs wrap these calls in their own logger.step().
//  For the same reason the tracker modules import
//  each other by relative path, not @utils/@constants:
//  plain `node` strips types but does not resolve
//  tsconfig path aliases (see scripts/upload-intake-files.ts).
//
//  Every write: take a lock file → re-read the
//  workbook → apply the change → recompute every
//  row's Control columns → write a temp file and
//  rename it over the original → release the lock.
//  The `api` project runs specs in parallel, so two
//  writers are normal, and re-reading under the lock
//  means neither overwrites the other's change.
// ─────────────────────────────────────────────

import { randomUUID } from 'crypto';
import { link, mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import {
    EMAIL_SUBJECT_PREFIX,
    REPO_ROOT,
    SKIPPED_STAGES,
    STAGES,
    STAGE_COLUMNS,
    isWaitStage,
    trackerPath,
    type PaymentChannel,
    type SkippedStages,
    type Stage,
    type StageStatus,
    type TrackerColumnKey,
} from '../../constants/tracker.config.ts';
import {
    deriveControl,
    evaluateStage,
    formatTimestamp,
    getChannel,
    getStatus,
    isDone,
    waitWindow,
    type CellValue,
    type TrackerRow,
    type WaitWindowTimes,
} from './trackerRules.util.ts';
import {
    buildTrackerWorkbook,
    fileExists,
    readTrackerFile,
    type ClaimRow,
    type TrackerData,
} from './trackerWorkbook.util.ts';

const LOCK_STALE_MS = 2 * 60_000;
const LOCK_TIMEOUT_MS = 60_000;
const BUSY_RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type NewControlCode = {
    controlCode: string;
    runId: string;
    /** Absolute path of the code's test-data/<CHANNEL>/<date>/ folder. */
    channelDir: string;
    paymentChannel: PaymentChannel;
    claimRows: Omit<ClaimRow, 'controlCode'>[];
};

export type EligibleCode = {
    controlCode: string;
    channel: PaymentChannel;
    /** The date of the code's test-data folder — pass to getChannelDir() instead of "today". */
    folderDate: Date;
    row: TrackerRow;
    /** Wait stages only: the deadline has passed, so a miss on this check is a timeout. */
    overdue: boolean;
    window: WaitWindowTimes | undefined;
};

export type StageQuery = {
    eligible: EligibleCode[];
    notDue: { controlCode: string; nextCheckAt: Date }[];
};

export type StageUpdate = {
    /** Extra columns to set alongside the status (file names, counts, references). */
    fields?: Partial<Record<TrackerColumnKey, CellValue>>;
    /** Free text for the Event Log — filename, blob folder, last DB state, error. */
    detail?: string;
    remark?: string;
};

/** "test-data/DPS/10.26.26" → Oct 26 2026 (local midnight). */
export function folderDateOf(row: TrackerRow): Date {
    const folder = String(row.testDataFolder ?? '');
    const match = /(\d{2})\.(\d{2})\.(\d{2})$/.exec(folder);
    if (!match) throw new Error(`Control Code "${row.controlCode}" has no dated Test Data Folder ("${folder}").`);
    const [, mm, dd, yy] = match;
    return new Date(2000 + Number(yy), Number(mm) - 1, Number(dd));
}

/**
 * First line only, capped, with any SAS signature redacted: this lands in a
 * workbook people share. An Azure error body can echo request details on
 * later lines; the first line ("Upload failed for X: 403 Forbidden") is the
 * useful part anyway.
 */
export function summarizeError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    const firstLine = message.split('\n')[0] ?? '';
    return firstLine.replace(/([?&]sig=)[^&\s]+/gi, '$1***').slice(0, 300);
}

/** "RUN-20261026-0915" — groups the codes one IntakeUpload run registered. */
export function newRunId(now: Date = new Date()): string {
    const stamp = formatTimestamp(now); // 2026-10-26 09:15:00
    return `RUN-${stamp.slice(0, 10).replace(/-/g, '')}-${stamp.slice(11, 16).replace(':', '')}`;
}

export class ControlCodeTracker {

    // Plain fields, not constructor parameter properties: plain `node`
    // (scripts/init-control-code-tracker.ts) only strips types, and
    // parameter properties aren't strippable syntax.
    readonly filePath: string;
    private readonly clock: () => Date;
    private readonly skippedStages: SkippedStages;

    constructor(filePath: string = trackerPath(), clock: () => Date = () => new Date(), skippedStages: SkippedStages = SKIPPED_STAGES) {
        this.filePath = filePath;
        this.clock = clock;
        this.skippedStages = skippedStages;
    }

    // ─── Reading ──────────────────────────────

    async read(): Promise<TrackerData> {
        return readTrackerFile(this.filePath);
    }

    async getRow(controlCode: string): Promise<TrackerRow | undefined> {
        const { rows } = await this.read();
        return rows.find((row) => row.controlCode === controlCode);
    }

    /**
     * Which codes `stage` may process right now, plus the ones whose wait
     * window hasn't reached "Next Check At" yet (so a spec can say when to
     * come back). Codes that are ineligible for any other reason — an
     * earlier stage not passed, already done — are simply left out.
     */
    async query(stage: Stage, options: { channels?: PaymentChannel[] } = {}): Promise<StageQuery> {
        const { rows, config } = await this.read();
        const now = this.clock();
        const result: StageQuery = { eligible: [], notDue: [] };

        for (const row of rows) {
            const channel = getChannel(row);
            if (!channel || (options.channels && !options.channels.includes(channel))) continue;

            const evaluation = evaluateStage(row, stage, config, now);
            if (evaluation.state === 'NOT_DUE') {
                result.notDue.push({ controlCode: String(row.controlCode), nextCheckAt: evaluation.window.nextCheckAt });
            } else if (evaluation.state === 'ELIGIBLE') {
                result.eligible.push({
                    controlCode: String(row.controlCode),
                    channel,
                    folderDate: folderDateOf(row),
                    row,
                    overdue: evaluation.overdue,
                    window: evaluation.window,
                });
            }
        }
        return result;
    }

    async getEligible(stage: Stage, options: { channels?: PaymentChannel[] } = {}): Promise<EligibleCode[]> {
        return (await this.query(stage, options)).eligible;
    }

    // ─── Writing ──────────────────────────────

    /** Creates an empty, formatted tracker if there isn't one yet. */
    async ensureExists(): Promise<void> {
        if (await fileExists(this.filePath)) return;
        await this.mutate(() => {});
    }

    /**
     * Adds a row per new control code (identity columns, Claim Rows, S2 = N/A
     * when no row needs a memo). Codes already in the tracker are left
     * untouched — their history is never reset by a re-run.
     *
     * `creationStatus` is S0's starting point: the intake generator registers
     * codes it is ABOUT to write as IN_PROGRESS (then passes each one as its
     * file lands); IntakeUpload.spec.ts registers files it found already on
     * disk as PASSED.
     */
    async register(
        entries: NewControlCode[],
        actor: string,
        options: { creationStatus?: 'IN_PROGRESS' | 'PASSED'; detail?: string } = {}
    ): Promise<{ added: string[]; existing: string[] }> {
        const creationStatus = options.creationStatus ?? 'PASSED';
        const added: string[] = [];
        const existing: string[] = [];

        await this.mutate((data, now) => {
            for (const entry of entries) {
                if (data.rows.some((row) => row.controlCode === entry.controlCode)) {
                    existing.push(entry.controlCode);
                    continue;
                }

                const memoRows = entry.claimRows.filter((r) => r.actionMemo === 'Y').length;
                const row: TrackerRow = {
                    controlCode: entry.controlCode,
                    runId: entry.runId,
                    testDataFolder: path.relative(REPO_ROOT, entry.channelDir).split(path.sep).join('/'),
                    paymentChannel: entry.paymentChannel,
                    scenario: memoRows > 0 ? 'NEGATIVE' : 'POSITIVE',
                    claimRowCount: entry.claimRows.length,
                    actionMemo: memoRows > 0 ? 'Y' : 'N',
                    actionMemoRows: memoRows,
                    s0Status: creationStatus,
                    s0At: formatTimestamp(now),
                    intakeFileName: creationStatus === 'PASSED' ? `${entry.controlCode}.xlsx` : undefined,
                    s1Status: 'NOT_STARTED',
                    s2Status: memoRows > 0 ? 'NOT_STARTED' : 'N/A',
                    expectedSubject: EMAIL_SUBJECT_PREFIX[entry.paymentChannel],
                    lastUpdatedAt: formatTimestamp(now),
                    lastUpdatedBy: actor,
                };
                data.rows.push(row);
                data.claimRows.push(...entry.claimRows.map((r) => ({ ...r, controlCode: entry.controlCode })));
                data.events.push({
                    timestamp: now, runId: entry.runId, controlCode: entry.controlCode, stage: 'S0_INTAKE_CREATION', from: '-', to: creationStatus,
                    actor, elapsedMinutes: undefined,
                    detail: `registered: ${entry.claimRows.length} claim row(s), ${memoRows} with Action Memo = Y` +
                        (options.detail ? ` — ${options.detail}` : ''),
                });
                added.push(entry.controlCode);
            }
        });
        return { added, existing };
    }

    async startStage(controlCode: string, stage: Stage, actor: string, update: StageUpdate = {}): Promise<void> {
        await this.transition(controlCode, stage, 'IN_PROGRESS', actor, update);
    }

    async passStage(controlCode: string, stage: Stage, actor: string, update: StageUpdate = {}): Promise<void> {
        await this.transition(controlCode, stage, 'PASSED', actor, update);
    }

    async failStage(controlCode: string, stage: Stage, actor: string, reason: string, update: StageUpdate = {}): Promise<void> {
        await this.transition(controlCode, stage, 'FAILED', actor, { ...update, remark: reason, detail: update.detail ?? reason });
    }

    /** A wait check ran but found no signal, and the deadline hasn't passed — logged as evidence of the last state. */
    async stillWaiting(controlCode: string, stage: Stage, actor: string, update: StageUpdate = {}): Promise<void> {
        await this.transition(controlCode, stage, 'WAITING', actor, update);
    }

    /** No signal by the deadline: stops this code only, and blocks its later stages. Never retried automatically. */
    async timeoutStage(controlCode: string, stage: Stage, actor: string, reason: string, update: StageUpdate = {}): Promise<void> {
        await this.transition(controlCode, stage, 'TIMED_OUT', actor, { ...update, remark: reason, detail: update.detail ?? reason });
    }

    /** The channel's shared Return File carries a different code — this one ends here. */
    async markNotCovered(controlCode: string, stage: Stage, actor: string, update: StageUpdate = {}): Promise<void> {
        await this.transition(controlCode, stage, 'NOT_COVERED', actor, update);
    }

    /**
     * The upload stages' shared shape: IN_PROGRESS → do the work → PASSED
     * with whatever fields it returns, or FAILED (retryable) with the
     * error's first line, then rethrow so the test still fails loudly.
     */
    async runStage(controlCode: string, stage: Stage, actor: string, work: () => Promise<StageUpdate | void>): Promise<void> {
        await this.startStage(controlCode, stage, actor);
        let update: StageUpdate | void;
        try {
            update = await work();
        } catch (err) {
            await this.failStage(controlCode, stage, actor, summarizeError(err));
            throw err;
        }
        await this.passStage(controlCode, stage, actor, update ?? {});
    }

    /**
     * Skips (N/A) any SKIPPED_STAGES stage a code has already reached — e.g.
     * S3 opened as WAITING before it was listed. Codes that reach a skipped
     * stage later are skipped as they pass the stage before it. Returns the
     * codes changed; writes nothing when there are none.
     */
    async applySkippedStages(actor: string): Promise<string[]> {
        const { rows } = await this.read();
        if (!rows.some((row) => this.reachedSkippedStages(row).length > 0)) return [];

        const changed: string[] = [];
        await this.mutate((data, now) => {
            for (const row of data.rows) {
                const stages = this.reachedSkippedStages(row);
                for (const stage of stages) this.skipStage(data, row, stage, actor, now);
                if (stages.length > 0) changed.push(String(row.controlCode));
            }
        });
        return changed;
    }

    /** Sets Remarks only — e.g. "signal query not resolvable" — without changing any status. */
    async note(controlCode: string, remark: string, actor: string): Promise<void> {
        await this.mutate((data, now) => {
            const row = this.findRow(data, controlCode);
            row.remarks = remark;
            row.lastUpdatedAt = formatTimestamp(now);
            row.lastUpdatedBy = actor;
        });
    }

    // ─── Internals ──────────────────────────────

    private findRow(data: TrackerData, controlCode: string): TrackerRow {
        const row = data.rows.find((r) => r.controlCode === controlCode);
        if (!row) throw new Error(`Control Code "${controlCode}" is not in the tracker (${this.filePath}).`);
        return row;
    }

    private async transition(controlCode: string, stage: Stage, to: StageStatus, actor: string, update: StageUpdate): Promise<void> {
        await this.mutate((data, now) => {
            const row = this.findRow(data, controlCode);
            const from = getStatus(row, stage);
            const columns = STAGE_COLUMNS[stage];
            const window = isWaitStage(stage) ? waitWindow(row, stage, data.config) : undefined;

            row[columns.status] = to;
            // WAITING keeps the timestamp blank: for a wait stage the "At"
            // column means "confirmed at", and nothing is confirmed yet.
            if (to !== 'WAITING') row[columns.at] = formatTimestamp(now);
            Object.assign(row, update.fields ?? {});
            if (update.remark !== undefined) row.remarks = update.remark;
            row.lastUpdatedAt = formatTimestamp(now);
            row.lastUpdatedBy = actor;

            data.events.push({
                timestamp: now, runId: String(row.runId ?? ''), controlCode, stage, from, to, actor,
                elapsedMinutes: window ? Math.round((now.getTime() - window.start.getTime()) / 60_000) : undefined,
                detail: update.detail ?? '',
            });

            const later = STAGES.slice(STAGES.indexOf(stage) + 1);
            if (to === 'TIMED_OUT') {
                for (const next of later) {
                    if (getStatus(row, next) !== 'N/A') row[STAGE_COLUMNS[next].status] = 'BLOCKED';
                }
            }

            // Passing a stage opens what comes next: a skipped stage
            // (SKIPPED_STAGES) becomes N/A on the spot, and the next wait
            // stage shows as WAITING straight away, logged, so the window
            // start is in the evidence.
            if (to === 'PASSED') {
                for (const next of later) {
                    const nextStatus = getStatus(row, next);
                    if (nextStatus === 'N/A') continue;
                    if (nextStatus === 'NOT_STARTED' && this.skippedStages[next]) {
                        this.skipStage(data, row, next, actor, now);
                        continue;
                    }
                    if (isWaitStage(next) && nextStatus === 'NOT_STARTED') {
                        row[STAGE_COLUMNS[next].status] = 'WAITING';
                        data.events.push({
                            timestamp: now, runId: String(row.runId ?? ''), controlCode, stage: next, from: 'NOT_STARTED', to: 'WAITING',
                            actor, elapsedMinutes: 0, detail: 'wait window opened',
                        });
                    }
                    break;
                }
            }
        });
    }

    /** Skipped stages this code has reached (every earlier stage done) but not yet marked N/A. */
    private reachedSkippedStages(row: TrackerRow): Stage[] {
        return STAGES.filter((stage, index) => {
            if (!this.skippedStages[stage]) return false;
            const status = getStatus(row, stage);
            if (status !== 'NOT_STARTED' && status !== 'WAITING') return false;
            return STAGES.slice(0, index).every((earlier) => isDone(getStatus(row, earlier)));
        });
    }

    /** N/A with the reason as the remark and in the Event Log — the stage was not verified. */
    private skipStage(data: TrackerData, row: TrackerRow, stage: Stage, actor: string, now: Date): void {
        const reason = this.skippedStages[stage] ?? 'skipped';
        const from = getStatus(row, stage);
        row[STAGE_COLUMNS[stage].status] = 'N/A';
        row.remarks = reason;
        row.lastUpdatedAt = formatTimestamp(now);
        row.lastUpdatedBy = actor;
        data.events.push({
            timestamp: now, runId: String(row.runId ?? ''), controlCode: String(row.controlCode), stage, from, to: 'N/A',
            actor, elapsedMinutes: undefined, detail: reason,
        });
    }

    private async mutate(change: (data: TrackerData, now: Date) => void): Promise<void> {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await this.withLock(async () => {
            const data = await this.read();
            const now = this.clock();
            change(data, now);
            for (const row of data.rows) Object.assign(row, deriveControl(row, data.config, now));
            await this.writeAtomically(data);
        });
    }

    private async writeAtomically(data: TrackerData): Promise<void> {
        const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
        await buildTrackerWorkbook(data).xlsx.writeFile(tempPath);

        for (let attempt = 1; ; attempt++) {
            try {
                await rename(tempPath, this.filePath);
                return;
            } catch (err) {
                const code = (err as NodeJS.ErrnoException).code;
                const busy = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
                if (busy && attempt < BUSY_RETRIES) {
                    await sleep(1_000 * attempt);
                    continue;
                }
                await rm(tempPath, { force: true });
                if (busy) {
                    throw new Error(
                        `Could not save ${path.basename(this.filePath)} — it is open in another program (${code}). ` +
                        'Close it in Excel and re-run; this step\'s status was NOT recorded.'
                    );
                }
                throw err;
            }
        }
    }

    /**
     * Two layers: writers in this process queue up in memory first, so they
     * never race each other for the lock file; the lock file then guards
     * against other processes (parallel Playwright workers, a script run
     * alongside a spec).
     */
    private async withLock<T>(fn: () => Promise<T>): Promise<T> {
        const previous = inProcessQueue.get(this.filePath) ?? Promise.resolve();
        let release!: () => void;
        const mine = previous.then(() => new Promise<void>((resolve) => { release = resolve; }));
        inProcessQueue.set(this.filePath, mine);

        await previous;
        try {
            return await this.withFileLock(fn);
        } finally {
            release();
            if (inProcessQueue.get(this.filePath) === mine) inProcessQueue.delete(this.filePath);
        }
    }

    private async withFileLock<T>(fn: () => Promise<T>): Promise<T> {
        const lockPath = `${this.filePath}.lock`;
        const token = `${process.pid} ${randomUUID()}`;
        const giveUpAt = Date.now() + LOCK_TIMEOUT_MS;

        for (;;) {
            try {
                await writeFile(lockPath, token, { flag: 'wx' }); // atomic create-if-absent
                break;
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
                if (await breakIfStale(lockPath)) continue;
                if (Date.now() > giveUpAt) {
                    throw new Error(`Timed out waiting for the tracker lock (${lockPath}). Delete it if no spec is running.`);
                }
                await sleep(150 + Math.random() * 250);
            }
        }

        try {
            return await fn();
        } finally {
            // Only remove the lock if it's still ours — never someone else's.
            const holder = await readFile(lockPath, 'utf-8').catch(() => undefined);
            if (holder === token) await rm(lockPath, { force: true });
        }
    }
}

// Per-file write queue shared by every ControlCodeTracker in this process.
const inProcessQueue = new Map<string, Promise<void>>();

const lockAge = (lockPath: string) => stat(lockPath).then((s) => Date.now() - s.mtimeMs, () => undefined);

/**
 * A lock older than LOCK_STALE_MS belongs to a crashed run — no healthy write
 * holds it anywhere near that long. It's moved aside with a rename rather
 * than deleted, because only one process can win that rename; and if the
 * file moved turns out to be fresh (someone replaced the stale lock between
 * our stat and our rename), it's put back with link(), which — like 'wx' —
 * only succeeds if no lock exists. Returns true when the caller should retry
 * at once (lock gone or broken), false to wait.
 */
async function breakIfStale(lockPath: string): Promise<boolean> {
    const age = await lockAge(lockPath);
    if (age === undefined) return true;
    if (age <= LOCK_STALE_MS) return false;

    const aside = `${lockPath}.${randomUUID()}.stale`;
    try {
        await rename(lockPath, aside);
    } catch {
        return true; // another process moved it first
    }

    const movedAge = await lockAge(aside);
    if (movedAge !== undefined && movedAge <= LOCK_STALE_MS) {
        await link(aside, lockPath).catch(() => {});
    }
    await rm(aside, { force: true });
    return true;
}
