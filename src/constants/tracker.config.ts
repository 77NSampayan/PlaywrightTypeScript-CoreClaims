// ─────────────────────────────────────────────
//  tracker.config.ts
//  Single source of truth for the Control Code
//  Tracker workbook (test-data/control-code-
//  tracker.xlsx): stages, statuses, columns and
//  default wait windows. Both the workbook builder
//  and the gating rules read from here, so adding
//  a column or a stage is a change in one place.
// ─────────────────────────────────────────────

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved from this file's own location (src/constants → ../..). */
const repoRoot = path.resolve(__dirname, '..', '..');

/**
 * Lives at the root of test-data/ (already gitignored), not inside a
 * <CHANNEL>/<date>/ folder, so clearing a day's generated files doesn't wipe
 * the tracker. TRACKER_PATH overrides it — used by ControlCodeTracker.spec.ts
 * to work against a throwaway copy rather than the real one.
 */
export function trackerPath(): string {
    return process.env.TRACKER_PATH || path.join(repoRoot, 'test-data', 'control-code-tracker.xlsx');
}

export const REPO_ROOT = repoRoot;

// ─── Stages ──────────────────────────────

// Order matters: a stage is only eligible once every earlier stage is PASSED
// (or N/A), and a wait stage's window opens at the previous stage's timestamp.
export const STAGES = [
    'S0_INTAKE_CREATION',
    'S1_INTAKE_UPLOAD',
    'S2_MEMO_UPLOAD',
    'S3_INTAKE_PROCESSED',
    'S4_CORECLAIMS_VISIBLE',
    'S5_PAYMENT_UPLOAD',
    'S6_PAYMENT_PROCESSED',
    'S7_PAYMENT_REFERENCE',
    'S8_SETTLEMENT_UPLOAD',
    'S9_TRANSMITTAL_F2307',
    'S10_EMAIL',
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_STATUSES = [
    'NOT_STARTED',
    'IN_PROGRESS',  // a spec has started it (an upload in flight)
    'WAITING',      // wait stage: window open, no DE/Blob/email signal yet
    'PASSED',
    'FAILED',       // upload error — retryable by re-running the spec
    'TIMED_OUT',    // wait passed its cap — manual investigation, never retried automatically
    'N/A',          // doesn't apply to this code (memos for an all-"N" file)
    'BLOCKED',      // an earlier stage timed out
    'NOT_COVERED',  // the channel's shared Return File carries a different code
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const OVERALL_STATUSES = ['IN_FLIGHT', 'PASSED', 'FAILED', 'MANUAL_INVESTIGATION', 'ENDED_NOT_COVERED'] as const;
export type OverallStatus = (typeof OVERALL_STATUSES)[number];

export type PaymentChannel = 'DPS' | 'UB' | 'COMCHECK';

export type StageDef = {
    label: string;
    /** 'action' stages run as soon as they're eligible; 'wait' stages also respect the Config sheet's window. */
    kind: 'action' | 'wait';
    /** Who advances this stage — shown in the "Next Step" column. */
    writer: string | Record<PaymentChannel, string>;
    /** Header band color (ARGB) — follows the swimlane's lanes. */
    color: string;
};

const INTAKE_COLOR = 'FF3B82C4';
const MEMO_COLOR = 'FF2F6FB5';
const PAYMENT_COLOR = 'FF1F4E8C';
const SETTLEMENT_COLOR = 'FF173B6B';
const EMAIL_COLOR = 'FF9D2B4B';

export const STAGE_DEFS: Record<Stage, StageDef> = {
    // Written by the generator itself: IN_PROGRESS for every code it is about
    // to create, PASSED as each intake file lands on disk.
    S0_INTAKE_CREATION: { label: 'S0 Intake File Creation', kind: 'action', writer: 'node scripts/generate-intake-batches.ts', color: INTAKE_COLOR },
    S1_INTAKE_UPLOAD: { label: 'S1 Intake Upload', kind: 'action', writer: 'IntakeUpload.spec.ts', color: INTAKE_COLOR },
    S2_MEMO_UPLOAD: { label: 'S2 Memo Upload', kind: 'action', writer: 'ClaimMemoUpload.spec.ts', color: MEMO_COLOR },
    S3_INTAKE_PROCESSED: { label: 'S3 Intake Processed (DE)', kind: 'wait', writer: 'PipelineSignalCheck.spec.ts', color: INTAKE_COLOR },
    S4_CORECLAIMS_VISIBLE: { label: 'S4 Visible in Core Claims', kind: 'action', writer: 'ClaimsQueryCheck.spec.ts', color: INTAKE_COLOR },
    S5_PAYMENT_UPLOAD: { label: 'S5 Payment Journal / Disbursement Upload', kind: 'action', writer: 'PaymentJournalUpload.spec.ts', color: PAYMENT_COLOR },
    S6_PAYMENT_PROCESSED: { label: 'S6 Payment Processed (DE)', kind: 'wait', writer: 'PipelineSignalCheck.spec.ts', color: PAYMENT_COLOR },
    S7_PAYMENT_REFERENCE: { label: 'S7 EP Number / NAV Pay Ref (DE)', kind: 'wait', writer: 'PipelineSignalCheck.spec.ts', color: PAYMENT_COLOR },
    S8_SETTLEMENT_UPLOAD: {
        label: 'S8 Return File / F2307 Upload',
        kind: 'action',
        writer: { DPS: 'ReturnFileUpload.spec.ts', UB: 'ReturnFileUpload.spec.ts', COMCHECK: 'F2307Upload.spec.ts' },
        color: SETTLEMENT_COLOR,
    },
    S9_TRANSMITTAL_F2307: { label: 'S9 Transmittal + F2307 (DE)', kind: 'wait', writer: 'PipelineSignalCheck.spec.ts', color: SETTLEMENT_COLOR },
    // No spec yet: the mailbox(es) and how an email maps back to a control
    // code are still unconfirmed, so this stage is confirmed by hand for now.
    S10_EMAIL: { label: 'S10 Email Notification', kind: 'wait', writer: 'manual check (mark PASSED in the tracker)', color: EMAIL_COLOR },
};

export function writerFor(stage: Stage, channel: PaymentChannel | undefined): string {
    const writer = STAGE_DEFS[stage].writer;
    if (typeof writer === 'string') return writer;
    return channel ? writer[channel] : Object.values(writer).join(' / ');
}

// ─── Wait windows (Config sheet defaults) ──────────────────────────────

export type WaitStage = 'S3_INTAKE_PROCESSED' | 'S6_PAYMENT_PROCESSED' | 'S7_PAYMENT_REFERENCE' | 'S9_TRANSMITTAL_F2307' | 'S10_EMAIL';

export type WaitWindow = {
    /**
     * Window start + this = "Next Check At": a check before it is a no-op.
     * For a stage with `jobEveryMinutes`: minutes after each DE run instead.
     */
    minWaitMinutes: number;
    /**
     * DE's job interval for this stage, on the clock (15 = :00/:15/:30/:45).
     * Set: checks follow DE's runs, and Cap ÷ this = how many runs a code
     * gets before it times out. Unset: plain window start + Min Wait / Cap.
     */
    jobEveryMinutes?: number;
    /** Window start + this = "Wait Deadline": still no signal after it → TIMED_OUT. */
    capMinutes: number;
    signal: string;
};

// Seeded into the Config sheet the first time the workbook is built, then
// read back from there on every run — edit the sheet, not this, to change a
// window for an existing tracker. Caps are still [TBC] in the swimlane; a
// 15-minute cap would miss most 30-minute DE jobs.
export const DEFAULT_WAIT_WINDOWS: Record<WaitStage, WaitWindow> = {
    // DE's intake job runs at :00/:15/:30/:45 and takes seconds (DONE at
    // 14:00:07 and 17:00:10 for uploads a few minutes earlier), so the
    // check follows the clock: 2 min after each run, 4 runs before timing out.
    S3_INTAKE_PROCESSED: { minWaitMinutes: 2, jobEveryMinutes: 15, capMinutes: 60, signal: 'de_op_file_tracker: file_name = <code>.xlsx, status DONE (job at :00/:15/:30/:45)' },
    S6_PAYMENT_PROCESSED: { minWaitMinutes: 30, capMinutes: 60, signal: 'DPS/UB: de_payment_journal · COMCHECK: de_nav_pay_ref (stand-in, real signal TBC)' },
    S7_PAYMENT_REFERENCE: { minWaitMinutes: 30, capMinutes: 60, signal: 'DPS/UB: transaction_no in de_dps_input / de_unionbank_input · COMCHECK: de_nav_pay_ref' },
    S9_TRANSMITTAL_F2307: { minWaitMinutes: 30, capMinutes: 60, signal: 'de_transmittal_details + de_f2307_pdf_generation (job every 30 min)' },
    S10_EMAIL: { minWaitMinutes: 30, capMinutes: 60, signal: 'Email in the channel mailbox (job every 30 min)' },
};

export function isWaitStage(stage: Stage): stage is WaitStage {
    return STAGE_DEFS[stage].kind === 'wait';
}

/**
 * An IN_PROGRESS stage older than this is treated as a crashed run and
 * becomes eligible again — younger than this, another run may still be
 * mid-upload, so it's left alone rather than uploaded twice.
 */
export const STALE_IN_PROGRESS_MINUTES = 15;

export type SkippedStages = Partial<Record<Stage, string>>;

/**
 * Stages skipped for now, each with the reason recorded on the code. A
 * skipped stage is set to N/A as soon as a code reaches it, so later stages
 * aren't held up by it. Delete an entry to bring the stage back: new codes go
 * through it again, and codes already skipped keep their N/A — truthfully,
 * since the stage was never verified for them.
 */
export const SKIPPED_STAGES: SkippedStages = {
    // Nothing skipped. S3 was listed here until the data_enrichment database
    // access arrived; while it is, ClaimsQueryCheck.spec.ts (S4) also skips
    // its DB row counts and only checks that each code shows up.
};

// Expected email subject prefix per channel, copied from the swimlane.
export const EMAIL_SUBJECT_PREFIX: Record<PaymentChannel, string> = {
    UB: 'MPI Claims ePayout - UBT',
    DPS: 'MPI Claims ePayout - DPS',
    COMCHECK: 'MPI Claims Check Payout - CHK',
};

// ─── Tracker sheet columns ──────────────────────────────

export type ColumnGroup = 'IDENTITY' | 'CONTROL' | Stage;

export type ColumnDef = {
    key: string;
    header: string;
    group: ColumnGroup;
    width: number;
    kind?: 'status' | 'timestamp' | 'number';
};

// Header text is what the workbook shows and what rows are read back by, so
// columns can be reordered here without breaking an existing tracker file —
// but renaming a header orphans that column's data in existing files.
export const TRACKER_COLUMNS = [
    // A. Identity — written once, by IntakeUpload.spec.ts
    { key: 'controlCode', header: 'Control Code', group: 'IDENTITY', width: 22 },
    { key: 'runId', header: 'Run ID', group: 'IDENTITY', width: 18 },
    { key: 'testDataFolder', header: 'Test Data Folder', group: 'IDENTITY', width: 26 },
    { key: 'paymentChannel', header: 'Payment Channel', group: 'IDENTITY', width: 10 },
    { key: 'scenario', header: 'Scenario', group: 'IDENTITY', width: 11 },
    { key: 'claimRowCount', header: 'Claim Row Count', group: 'IDENTITY', width: 9, kind: 'number' },
    { key: 'actionMemo', header: 'Action Memo', group: 'IDENTITY', width: 8 },
    { key: 'actionMemoRows', header: 'Action Memo Rows', group: 'IDENTITY', width: 9, kind: 'number' },

    // B. Control — recomputed on every write; what a person reads
    { key: 'currentStage', header: 'Current Stage', group: 'CONTROL', width: 24 },
    { key: 'currentStatus', header: 'Current Status', group: 'CONTROL', width: 14, kind: 'status' },
    { key: 'nextStep', header: 'Next Step', group: 'CONTROL', width: 44 },
    { key: 'waitWindowStart', header: 'Wait Window Start', group: 'CONTROL', width: 19, kind: 'timestamp' },
    { key: 'nextCheckAt', header: 'Next Check At', group: 'CONTROL', width: 19, kind: 'timestamp' },
    { key: 'waitDeadline', header: 'Wait Deadline', group: 'CONTROL', width: 19, kind: 'timestamp' },
    { key: 'overallStatus', header: 'Overall Status', group: 'CONTROL', width: 22 },
    { key: 'lastUpdatedAt', header: 'Last Updated At', group: 'CONTROL', width: 19, kind: 'timestamp' },
    { key: 'lastUpdatedBy', header: 'Last Updated By', group: 'CONTROL', width: 28 },
    { key: 'remarks', header: 'Remarks', group: 'CONTROL', width: 40 },

    // C. Stages — Status + timestamp first (always visible), details after (collapsible)
    { key: 's0Status', header: 'S0 Status', group: 'S0_INTAKE_CREATION', width: 13, kind: 'status' },
    { key: 's0At', header: 'S0 Created At', group: 'S0_INTAKE_CREATION', width: 19, kind: 'timestamp' },
    { key: 'intakeFileName', header: 'Intake File', group: 'S0_INTAKE_CREATION', width: 26 },

    { key: 's1Status', header: 'S1 Status', group: 'S1_INTAKE_UPLOAD', width: 13, kind: 'status' },
    { key: 's1At', header: 'S1 Uploaded At', group: 'S1_INTAKE_UPLOAD', width: 19, kind: 'timestamp' },

    { key: 's2Status', header: 'S2 Status', group: 'S2_MEMO_UPLOAD', width: 13, kind: 'status' },
    { key: 's2At', header: 'S2 Uploaded At', group: 'S2_MEMO_UPLOAD', width: 19, kind: 'timestamp' },
    { key: 'amUploaded', header: 'AM Uploaded', group: 'S2_MEMO_UPLOAD', width: 9, kind: 'number' },
    { key: 'dmUploaded', header: 'DM Uploaded', group: 'S2_MEMO_UPLOAD', width: 9, kind: 'number' },

    { key: 's3Status', header: 'S3 Status', group: 'S3_INTAKE_PROCESSED', width: 13, kind: 'status' },
    { key: 's3At', header: 'S3 Confirmed At', group: 'S3_INTAKE_PROCESSED', width: 19, kind: 'timestamp' },
    { key: 'deStatus', header: 'DE Status', group: 'S3_INTAKE_PROCESSED', width: 16 },
    { key: 'deClaimLines', header: 'DE Claim Lines', group: 'S3_INTAKE_PROCESSED', width: 9, kind: 'number' },
    { key: 'billedLines', header: 'Billed Lines', group: 'S3_INTAKE_PROCESSED', width: 9, kind: 'number' },

    { key: 's4Status', header: 'S4 Status', group: 'S4_CORECLAIMS_VISIBLE', width: 13, kind: 'status' },
    { key: 's4At', header: 'S4 Checked At', group: 'S4_CORECLAIMS_VISIBLE', width: 19, kind: 'timestamp' },
    { key: 'expectedRefCount', header: 'Expected Ref Count', group: 'S4_CORECLAIMS_VISIBLE', width: 9, kind: 'number' },
    { key: 'foundRefCount', header: 'Found Ref Count', group: 'S4_CORECLAIMS_VISIBLE', width: 9, kind: 'number' },

    { key: 's5Status', header: 'S5 Status', group: 'S5_PAYMENT_UPLOAD', width: 13, kind: 'status' },
    { key: 's5At', header: 'S5 Uploaded At', group: 'S5_PAYMENT_UPLOAD', width: 19, kind: 'timestamp' },
    { key: 'paymentFileType', header: 'Payment File Type', group: 'S5_PAYMENT_UPLOAD', width: 17 },
    { key: 'paymentFileName', header: 'Payment File Name', group: 'S5_PAYMENT_UPLOAD', width: 38 },
    { key: 'documentNo', header: 'Document No / Check No', group: 'S5_PAYMENT_UPLOAD', width: 24 },

    { key: 's6Status', header: 'S6 Status', group: 'S6_PAYMENT_PROCESSED', width: 13, kind: 'status' },
    { key: 's6At', header: 'S6 Confirmed At', group: 'S6_PAYMENT_PROCESSED', width: 19, kind: 'timestamp' },
    { key: 'paymentSignalSource', header: 'Signal Source', group: 'S6_PAYMENT_PROCESSED', width: 30 },

    { key: 's7Status', header: 'S7 Status', group: 'S7_PAYMENT_REFERENCE', width: 13, kind: 'status' },
    { key: 's7At', header: 'S7 Confirmed At', group: 'S7_PAYMENT_REFERENCE', width: 19, kind: 'timestamp' },
    { key: 'paymentReference', header: 'Payment Reference (EP No / NAV Ref)', group: 'S7_PAYMENT_REFERENCE', width: 26 },

    { key: 's8Status', header: 'S8 Status', group: 'S8_SETTLEMENT_UPLOAD', width: 13, kind: 'status' },
    { key: 's8At', header: 'S8 Uploaded At', group: 'S8_SETTLEMENT_UPLOAD', width: 19, kind: 'timestamp' },
    { key: 'settlementFileType', header: 'Settlement File Type', group: 'S8_SETTLEMENT_UPLOAD', width: 14 },
    { key: 'settlementFileName', header: 'Settlement File Name', group: 'S8_SETTLEMENT_UPLOAD', width: 44 },
    { key: 'coveredByFile', header: 'Covered By File', group: 'S8_SETTLEMENT_UPLOAD', width: 9 },
    { key: 'epNumberInFile', header: 'EP Number In File', group: 'S8_SETTLEMENT_UPLOAD', width: 20 },

    { key: 's9Status', header: 'S9 Status', group: 'S9_TRANSMITTAL_F2307', width: 13, kind: 'status' },
    { key: 's9At', header: 'S9 Confirmed At', group: 'S9_TRANSMITTAL_F2307', width: 19, kind: 'timestamp' },
    { key: 'transmittalFound', header: 'Transmittal Found', group: 'S9_TRANSMITTAL_F2307', width: 10 },
    { key: 'f2307Generated', header: 'F2307 Generated', group: 'S9_TRANSMITTAL_F2307', width: 10 },
    { key: 'f2307OutputPath', header: 'F2307 Output Path', group: 'S9_TRANSMITTAL_F2307', width: 40 },

    { key: 's10Status', header: 'S10 Status', group: 'S10_EMAIL', width: 13, kind: 'status' },
    { key: 's10At', header: 'S10 Received At', group: 'S10_EMAIL', width: 19, kind: 'timestamp' },
    { key: 'expectedSubject', header: 'Expected Subject', group: 'S10_EMAIL', width: 30 },
    { key: 'mailbox', header: 'Mailbox', group: 'S10_EMAIL', width: 18 },
] as const satisfies readonly ColumnDef[];

export type TrackerColumnKey = (typeof TRACKER_COLUMNS)[number]['key'];

/** Status and timestamp column for each stage — e.g. S5 → 's5Status' / 's5At'. */
export const STAGE_COLUMNS: Record<Stage, { status: TrackerColumnKey; at: TrackerColumnKey }> = {
    S0_INTAKE_CREATION: { status: 's0Status', at: 's0At' },
    S1_INTAKE_UPLOAD: { status: 's1Status', at: 's1At' },
    S2_MEMO_UPLOAD: { status: 's2Status', at: 's2At' },
    S3_INTAKE_PROCESSED: { status: 's3Status', at: 's3At' },
    S4_CORECLAIMS_VISIBLE: { status: 's4Status', at: 's4At' },
    S5_PAYMENT_UPLOAD: { status: 's5Status', at: 's5At' },
    S6_PAYMENT_PROCESSED: { status: 's6Status', at: 's6At' },
    S7_PAYMENT_REFERENCE: { status: 's7Status', at: 's7At' },
    S8_SETTLEMENT_UPLOAD: { status: 's8Status', at: 's8At' },
    S9_TRANSMITTAL_F2307: { status: 's9Status', at: 's9At' },
    S10_EMAIL: { status: 's10Status', at: 's10At' },
};

// ─── Other sheets ──────────────────────────────

// No member names or member codes anywhere in the tracker — only the
// consultation/transaction ID, which is generated, not patient data.
export const CLAIM_ROW_HEADERS = ['Control Code', 'Row #', 'Consultation/Transaction ID', 'Action Memo'] as const;

export const EVENT_LOG_HEADERS = ['Timestamp', 'Run ID', 'Control Code', 'Stage', 'From', 'To', 'Actor', 'Elapsed (min)', 'Detail'] as const;

export const CONFIG_HEADERS = ['Stage', 'Min Wait (min)', 'Cap (min)', 'DE Job Every (min)', 'Signal'] as const;

// Upload destination per stage/channel — documentation only (Legend sheet);
// the specs that upload keep their own folder constants.
export const BLOB_FOLDERS: [string, string][] = [
    ['S1 Intake (all channels)', 'testblob/Out-Patient Teleconsulation'],
    ['S2 Action Memo', 'testblob/Action_Memo/OP_Teleconsultation (+ /COM_CHECK for COMCHECK)'],
    ['S2 Disapproval Memo', 'testblob/Disapproved_Memo/OP_Teleconsultation (+ /COM_CHECK for COMCHECK)'],
    ['S5 Payment Journal (DPS, UB)', 'claimsblob/Data Enrichment/paymentjournal'],
    ['S5 Disbursement (COMCHECK)', 'claimsblob/Data Enrichment/comm_check'],
    ['S8 Return File (DPS)', 'testblob/ReturnFile_OPTeleconsult/DPS'],
    ['S8 Return File (UB)', 'testblob/ReturnFile_OPTeleconsult/UnionBank'],
    ['S8 F2307 (COMCHECK)', 'testblob/F2307 Output/COM_CHECK'],
];

export const STATUS_MEANINGS: Record<StageStatus, string> = {
    NOT_STARTED: 'Not reached yet.',
    IN_PROGRESS: 'A spec or generator is running this stage. Older than 15 min = crashed run, eligible again.',
    WAITING: 'Waiting for a DE / Blob / email signal. Re-run the check after "Next Check At".',
    PASSED: 'Done. The next stage can run.',
    FAILED: 'Upload or check error. Re-running the spec retries it.',
    TIMED_OUT: 'No signal by the deadline. Manual investigation — never retried, re-uploaded or extended automatically.',
    'N/A': 'Does not apply to this code (e.g. memos when no row has Action Memo = Y), or the stage is skipped for now — see Remarks.',
    BLOCKED: 'An earlier stage timed out.',
    NOT_COVERED: "The channel's shared Return File carries a different control code — this code ends here.",
};

// Fill colors for status cells (ARGB).
export const STATUS_FILL: Partial<Record<StageStatus, string>> = {
    IN_PROGRESS: 'FFFFF2CC',
    WAITING: 'FFFCE4D6',
    PASSED: 'FFC6EFCE',
    FAILED: 'FFFFC7CE',
    TIMED_OUT: 'FFFF9999',
    'N/A': 'FFEDEDED',
    BLOCKED: 'FFD9D9D9',
    NOT_COVERED: 'FFDDEBF7',
};
