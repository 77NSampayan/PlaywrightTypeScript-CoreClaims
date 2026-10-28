// Generates OPEML claim-upload test data for the three payment modes (DPS,
// ComCheck, UB/UnionBank), as two batches:
//
//   - NEGATIVE batch (first 3 files): 2 rows each — the 1st row is complete
//     and passing (Action Memo = "N"), and only the 2nd row is the
//     deliberate failure (blank Diagnosis/Dx Code, Action Memo = "Y"). Not
//     every row in the file fails.
//   - POSITIVE batch (next 3 files): same doctor-per-payment-mode mapping
//     and column structure, but every row is complete (Action Memo = "N",
//     Diagnosis/Dx Code filled in) and uses different patients.
//
// Filenames are OPEML<today's date, YYYYMMDD><5 random digits>T. The digits
// are random (00001-99999) rather than a running counter, so local runs and
// GitHub Actions on the same day don't hand out the same codes. A number is
// never reused on this machine: the ones already used today are read from
// .intake-sequence-state.json (next to this script) and from the Control
// Code Tracker before picking. Two different machines can still, rarely,
// pick the same number (~0.1% for two machines making 12 codes each a day).
//
// Schema, column widths, and the fixed test-environment values (Source
// System, Approval No, OTP, PF Amount, Claim Type, Procedure, Care Setting,
// Claim Sub Type) are copied from the reference files
// OPEML2026092900428T/429T/430T.xlsx in the repo root.
//
// Patient names/member codes come from the "MEMBERS WITH ACTIVE POLICY IN
// STAGING" fixture list, confirmed by the test data owner to be synthetic
// QA accounts rather than real customers — not invented by this script, and
// not real member data either way, per the org policy against writing
// customer PII into generated test data. Doctor names are kept as-is: they
// are the system's own physician/payment-mode routing reference data, which
// is the actual thing under test here, not patient PII.
//
// Usage:
//     node scripts/generate-intake-batches.ts
//     PAYMENT_MODE_FILTER=UB node scripts/generate-intake-batches.ts   # UB only
//
// Output (example, run on 2026-10-05, first run of the day, no filter) — one
// folder per payment channel, then date; every other generator's output for
// that channel (memos, payment journal, return file, disbursement, F2307)
// lands in the same date folder alongside the intake file, not a separate one:
//     test-data/DPS/10.05.26/OPEML2026100500001T.xlsx        (DPS,      negative)
//     test-data/COM CHECK/10.05.26/OPEML2026100500002T.xlsx  (ComCheck, negative)
//     test-data/UB/10.05.26/OPEML2026100500003T.xlsx         (UB,       negative)
//     test-data/DPS/10.05.26/OPEML2026100500004T.xlsx        (DPS,      positive)
//     test-data/COM CHECK/10.05.26/OPEML2026100500005T.xlsx  (ComCheck, positive)
//     test-data/UB/10.05.26/OPEML2026100500006T.xlsx         (UB,       positive)
//
// Every run also updates the Control Code Tracker (test-data/control-code-
// tracker.xlsx, stage S0): each new code goes in as IN_PROGRESS when the run
// starts and turns PASSED as its file is written, with a console log of
// both steps. Close the tracker in Excel first — an open file can't be saved.

import ExcelJS from 'exceljs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
// Relative, not @utils: this script runs under plain `node`, which doesn't
// resolve tsconfig path aliases (see scripts/upload-intake-files.ts).
import { ControlCodeTracker, newRunId, summarizeError } from '../src/utils/tracker/ControlCodeTracker.util.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(__dirname);
const STATE_FILE = path.join(__dirname, '.intake-sequence-state.json');

// Ad hoc "generate as if it were a different day" override (e.g. preparing
// tomorrow's happy-path test data ahead of time) — FAKE_TODAY=YYYY-MM-DD.
// Not meant as a standing feature to rely on; defaults to the real date.
function getToday(): Date {
    const override = process.env.FAKE_TODAY;
    if (override) {
        const parsed = new Date(`${override}T00:00:00`);
        if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
}

const HEADERS = [
    'Member Code', 'Name', 'Company', 'Diagnosis', 'Dx Code', 'Doctor',
    'Source System', 'Visit Date', 'Visit Time', 'Consultation/Transaction ID',
    'Approval No', 'OTP', 'PF Amount', 'Control Code', 'Claim Type',
    'Procedure', 'Received Date', 'Care Setting', 'Claim Sub Type', 'Action Memo',
];

export type PaymentMode = 'DPS' | 'COMCHECK' | 'UB';
export const ALL_PAYMENT_MODES: PaymentMode[] = ['DPS', 'COMCHECK', 'UB'];

// Per-channel/date folder layout: test-data/<CHANNEL>/<MM.DD.YY>/ — every
// artifact type for that channel (intake, memos, payment journal, return
// file, disbursement, F2307) lands in the same date folder together,
// distinguished by filename convention, not by further subfolders.
export const CHANNEL_FOLDER: Record<PaymentMode, string> = {
    DPS: 'DPS',
    COMCHECK: 'COM CHECK',
    UB: 'UB',
};

export function formatDateFolder(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${month}.${day}.${year}`;
}

export function getChannelDir(paymentMode: PaymentMode, date: Date = getToday()): string {
    return path.join(REPO_ROOT, 'test-data', CHANNEL_FOLDER[paymentMode], formatDateFolder(date));
}

// Reliably identifies an intake-batch file inside a channel's mixed folder —
// payment journal/return file/disbursement/F2307/memo output sits alongside
// it there too. Every intake filename is OPEML<date><counter>T.xlsx, and no
// other artifact's .xlsx output starts with "OPEML" (memos share that
// control-code prefix but are always .pdf, never .xlsx).
export function isIntakeFilename(name: string): boolean {
    return /^OPEML.*\.xlsx$/i.test(name);
}

export type IntakeRow = {
    controlCode: string;
    /** 1-based, excluding the header. */
    rowNumber: number;
    transactionId: string;
    actionMemo: string;
};

// Every row of one intake file — same column mapping as readFailedRows()/
// readPassingRows() (14 = Control Code, 10 = Consultation/Transaction ID,
// 20 = Action Memo). Deliberately skips Member Code/Name: this feeds the
// Control Code Tracker, which holds no patient identifiers.
export async function readIntakeRows(filePath: string): Promise<IntakeRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];

    const rows: IntakeRow[] = [];
    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // header
        const controlCode = String(row.getCell(14).value ?? '').trim();
        if (!controlCode) return;
        rows.push({
            controlCode,
            rowNumber: rowNumber - 1,
            transactionId: String(row.getCell(10).value ?? '').trim(),
            actionMemo: String(row.getCell(20).value ?? '').trim(),
        });
    });
    return rows;
}

// Ad hoc "generate for one payment mode only" override, e.g.
// PAYMENT_MODE_FILTER=UB — same reasoning as FAKE_TODAY above: not a
// standing feature to rely on, defaults to every mode. Every generator that
// loops over payment modes (intake batches, Payment Journal, Disbursement
// File, F2307, claim memos) reads this via filterPaymentModes()/
// matchesPaymentModeFilter() rather than its own copy of the env lookup.
export function getPaymentModeFilter(): PaymentMode | null {
    const override = process.env.PAYMENT_MODE_FILTER?.trim().toUpperCase();
    if (!override) return null;
    if (!ALL_PAYMENT_MODES.includes(override as PaymentMode)) {
        throw new Error(`Invalid PAYMENT_MODE_FILTER "${override}" — expected one of ${ALL_PAYMENT_MODES.join(', ')}.`);
    }
    return override as PaymentMode;
}

// Narrows a list of modes to the active PAYMENT_MODE_FILTER, if any. Generic
// over T (rather than just PaymentMode) so callers with a narrower mode
// subset — e.g. generate-payment-journal.ts's JournalPaymentMode = 'DPS' |
// 'UB' — get that same narrower type back, not the full PaymentMode union.
export function filterPaymentModes<T extends PaymentMode>(modes: T[]): T[] {
    const filter = getPaymentModeFilter();
    return filter ? modes.filter((mode): mode is T => (mode as PaymentMode) === filter) : modes;
}

// True when `mode` should be generated under the active PAYMENT_MODE_FILTER
// (i.e. no filter is set, or it matches) — for generators that are only
// ever one fixed mode (F2307/Disbursement = ComCheck, Return File = DPS)
// rather than looping over a list.
export function matchesPaymentModeFilter(mode: PaymentMode): boolean {
    const filter = getPaymentModeFilter();
    return !filter || filter === mode;
}

// Doctor name(s) must match the live system's physician master data exactly,
// including the trailing space on some of these (present in the reference
// files too) — the app looks the doctor up by this string, so a "cleaned
// up" name would silently break the payment-mode routing.
//
// ComCheck has exactly one valid doctor — VILLANUEVA, PURA CORAZON REYES.
// JAN ROSLYN T. EMPINADO was removed per explicit instruction. UB's doctor
// has been replaced per explicit instruction twice now — MA. TERESA VICTORIA
// LUCIA DIMAGIBA, then ALEJANDRINO, ROSARIO JULIA MARGARITA CHANTAL S., now
// GALEDO, EVELYN SHIELA H. The array shape (rather than a single string) is
// kept for all three modes so pickDoctor()/isDoctorForMode() stay generic if
// a mode ever needs more than one again.
export const PAYMENT_MODE_DOCTORS: Record<PaymentMode, string[]> = {
    DPS: ['TOMAS ANTONIO'],
    COMCHECK: ['VILLANUEVA, PURA CORAZON REYES'],
    UB: ['GALEDO, EVELYN SHIELA H.'],
};

export function pickDoctor(paymentMode: PaymentMode): string {
    const doctors = PAYMENT_MODE_DOCTORS[paymentMode];
    return doctors[Math.floor(Math.random() * doctors.length)]!;
}

export function isDoctorForMode(doctor: string, paymentMode: PaymentMode): boolean {
    return PAYMENT_MODE_DOCTORS[paymentMode].some((d) => d.trim() === doctor.trim());
}

// Fixed test-environment values, reused verbatim from the reference files —
// these are system/test config constants, not patient data.
const COMMON_FIELDS = {
    company: undefined,
    sourceSystem: 'SeriousMD',
    approvalNo: 'MACEII1288460',
    otp: 61042,
    pfAmount: 0,
    claimType: 'OP',
    procedure: 'Teleconsultation',
    careSetting: 'PF',
    claimSubType: 'TELEMEDICINE',
};

// Reference files' Consultation/Transaction IDs were a 20-char prefix plus
// a 4-digit suffix (e.g. 69f1743bfba5000dc5bc5600). The suffix is now
// random digits only (0-9, no hex letters) rather than sequential, with
// uniqueness enforced within each run (a collision is re-rolled) — 10000
// possible values comfortably covers the handful of rows generated per run.
const TRANSACTION_ID_PREFIX = '69f1743bfba5000dc5bc';
const usedTransactionSuffixes = new Set<string>();

function nextTransactionId(): string {
    let suffix: string;
    do {
        suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    } while (usedTransactionSuffixes.has(suffix));
    usedTransactionSuffixes.add(suffix);

    return `${TRANSACTION_ID_PREFIX}${suffix}`;
}

// Persisted so a random number is never handed out twice on this machine in
// one day. The tracker is checked too, but this survives a tracker that was
// deleted or reset. Lives next to the script, not under test-data/, so
// deleting generated output doesn't reset it.
type SequenceState = {
    /** YYYYMMDD of the last run — the used list starts over on a new date. */
    date: string;
    /** Numbers (the 5 digits after the date) already used on `date`. */
    used?: number[];
    /** State files from before numbers were random: the last running counter used on `date`. */
    lastCounter?: number;
};

async function loadState(): Promise<SequenceState> {
    try {
        const raw = await readFile(STATE_FILE, 'utf-8');
        return JSON.parse(raw) as SequenceState;
    } catch {
        return { date: '' };
    }
}

const MAX_CONTROL_NUMBER = 99_999;

// Every number already used today on this machine: the state file (for one
// written before numbers were random, 1..lastCounter) and every code of
// today's date already in the tracker.
function usedToday(state: SequenceState, today: string, trackerCodes: string[]): Set<number> {
    const used = new Set<number>();
    if (state.date === today) {
        for (const n of state.used ?? []) used.add(n);
        for (let n = 1; n <= (state.lastCounter ?? 0); n++) used.add(n);
    }
    for (const code of trackerCodes) {
        const match = /^OPEML(\d{8})(\d{5})T$/.exec(code);
        if (match && match[1] === today) used.add(Number(match[2]));
    }
    return used;
}

// Same re-roll-on-collision approach as nextTransactionId() above.
function nextControlNumber(used: Set<number>): number {
    if (used.size >= MAX_CONTROL_NUMBER) {
        throw new Error(`Every control code number for today is already used (${MAX_CONTROL_NUMBER}).`);
    }
    let n: number;
    do {
        n = Math.floor(Math.random() * MAX_CONTROL_NUMBER) + 1; // 00001-99999
    } while (used.has(n));
    used.add(n);
    return n;
}

async function saveState(state: SequenceState): Promise<void> {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function todayYyyyMmDd(): string {
    const now = getToday();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}${month}${day}`;
}

function formatMmDdYyyy(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}/${date.getFullYear()}`;
}

function buildFilename(date: string, controlNumber: number): string {
    return `OPEML${date}${String(controlNumber).padStart(5, '0')}T`;
}

type Patient = { memberCode: number; name: string };

// "MEMBERS WITH ACTIVE POLICY IN STAGING" fixture pool — confirmed by the
// test data owner to be synthetic QA accounts, not real customers, so safe
// to use directly. These are also the only Member Codes the staging upload
// actually validates against, which a made-up code would not pass.
const PATIENT_POOL: Patient[] = [
    { memberCode: 35683384, name: 'MA. MYLENE C SUBIDO' },
    { memberCode: 35683407, name: 'EMMA B CO' },
    { memberCode: 35757812, name: 'AMABELLE GAY P JIMENEZ' },
    { memberCode: 33725678, name: 'NIEVA DINGLASAN' },
    { memberCode: 33725679, name: 'ROMEO DINGLASAN' },
    { memberCode: 33725677, name: 'ROVIE MAIDA A DINGLASAN' },
];

// Picks `count` distinct patients at random from the pool, excluding any
// already handed to another batch this run — so the positive batch doesn't
// coincidentally reuse a negative-batch patient, the way the old fixed
// 3-patient setup sometimes had to.
function pickRandomPatients(count: number, exclude: Patient[] = []): Patient[] {
    const excludedCodes = new Set(exclude.map((p) => p.memberCode));
    const available = PATIENT_POOL.filter((p) => !excludedCodes.has(p.memberCode));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
}

// Only this one confirmed diagnosis/Dx Code pair is used — not invented,
// and not alternated with any other diagnosis.
const SAMPLE_DIAGNOSIS = { diagnosis: 'Acute upper respiratory infection', dxCode: 'Dx2473' };

type BatchEntry = { filename: string; paymentMode: PaymentMode };

// Fixed order (DPS, ComCheck, UB) within both batches, matching the
// reference files — only the filename counter advances between entries.
const PAYMENT_MODE_ORDER: PaymentMode[] = ['DPS', 'COMCHECK', 'UB'];

const VISIT_TIMES = ['12:46:50', '12:46:51'];

// Match the reference files' column widths so the generated sheet looks the
// same, not just carries the same data.
const COLUMN_WIDTHS = [
    10.06, 23.7, 9.52, 29.4, 27.54, 13.0,
    13.87, 11.94, 17.11, 26.12, 20.61, 5.82,
    4.6, 20.38, 4.6, 15.73, 18.68, 4.24,
    14.54, 9.18,
];

type PlannedRow = { patient: Patient; actionMemo: 'Y' | 'N'; visitTime: string; transactionId: string };

// One intake file, fully decided before anything is written — so the
// Control Code Tracker can be told every code (and its rows) up front, as
// IN_PROGRESS, before the first file lands.
type PlannedFile = BatchEntry & { negative: boolean; channelDir: string; rows: PlannedRow[] };

function planFile(entry: BatchEntry, patients: Patient[], negative: boolean, today: Date): PlannedFile {
    const rows = patients.map((patient, i): PlannedRow => ({
        patient,
        // In a negative-batch file, only the 2nd row is the deliberate
        // failure (blank Diagnosis/Dx Code, Action Memo = "Y") — the 1st row
        // is complete and passing, so the file isn't "every row fails."
        // Positive batches are unaffected: every row stays complete/"N".
        actionMemo: negative && i > 0 ? 'Y' : 'N',
        visitTime: VISIT_TIMES[i % VISIT_TIMES.length]!,
        transactionId: nextTransactionId(),
    }));
    return { ...entry, negative, channelDir: getChannelDir(entry.paymentMode, today), rows };
}

function buildWorkbook(file: PlannedFile, visitDate: string, receivedDate: string): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(file.filename);

    sheet.columns = HEADERS.map((header, i) => ({ header, width: COLUMN_WIDTHS[i]! }));

    const doctor = pickDoctor(file.paymentMode);

    for (const row of file.rows) {
        const rowFails = row.actionMemo === 'Y';
        sheet.addRow([
            row.patient.memberCode,
            row.patient.name,
            COMMON_FIELDS.company,
            rowFails ? '' : SAMPLE_DIAGNOSIS.diagnosis,
            rowFails ? '' : SAMPLE_DIAGNOSIS.dxCode,
            doctor,
            COMMON_FIELDS.sourceSystem,
            visitDate,
            row.visitTime,
            row.transactionId,
            COMMON_FIELDS.approvalNo,
            COMMON_FIELDS.otp,
            COMMON_FIELDS.pfAmount,
            file.filename,
            COMMON_FIELDS.claimType,
            COMMON_FIELDS.procedure,
            receivedDate,
            COMMON_FIELDS.careSetting,
            COMMON_FIELDS.claimSubType,
            row.actionMemo,
        ]);
    }

    return workbook;
}

const TRACKER_ACTOR = 'generate-intake-batches.ts';

export type GeneratedIntakeFile = { controlCode: string; paymentMode: PaymentMode; filePath: string; negative: boolean };

const repoRelative = (p: string) => path.relative(REPO_ROOT, p).split(path.sep).join('/');

function describeFile(file: PlannedFile): string {
    const memoRows = file.rows.filter((r) => r.actionMemo === 'Y').length;
    return `${file.filename}  ${CHANNEL_FOLDER[file.paymentMode].padEnd(9)} ${(file.negative ? 'NEGATIVE' : 'POSITIVE').padEnd(9)} ` +
        `${file.rows.length} row(s), ${memoRows} Action Memo`;
}

// Exported so tests/IntakeUpload.spec.ts can call it directly (generate a
// sample batch on demand when no intake files exist for today) instead of
// requiring a separate manual `node scripts/generate-intake-batches.ts` step.
//
// Also stage S0 of the Control Code Tracker (test-data/control-code-
// tracker.xlsx): every code is registered as IN_PROGRESS before the first
// file is written, then each one is marked PASSED (or FAILED) as its file
// lands — so the tracker shows a creation run while it's happening, not
// only after. A tracker that can't be saved (open in Excel) stops the run
// before any file is written.
export async function generateIntakeBatches(): Promise<GeneratedIntakeFile[]> {
    const state = await loadState();
    const now = getToday();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const today = todayYyyyMmDd();
    // Visit Date is the day before the claim is received/uploaded.
    const visitDate = formatMmDdYyyy(yesterday);
    const receivedDate = formatMmDdYyyy(now);

    const tracker = new ControlCodeTracker();
    const { rows: trackerRows } = await tracker.read();
    const used = usedToday(state, today, trackerRows.map((row) => String(row.controlCode ?? '')));

    const activeModes = filterPaymentModes(PAYMENT_MODE_ORDER);
    const negativeBatch: BatchEntry[] = activeModes.map((paymentMode) => ({ filename: buildFilename(today, nextControlNumber(used)), paymentMode }));
    const positiveBatch: BatchEntry[] = activeModes.map((paymentMode) => ({ filename: buildFilename(today, nextControlNumber(used)), paymentMode }));

    const negativePatients = pickRandomPatients(2);
    const positivePatients = pickRandomPatients(2, negativePatients);

    const planned = [
        ...negativeBatch.map((entry) => planFile(entry, negativePatients, true, now)),
        ...positiveBatch.map((entry) => planFile(entry, positivePatients, false, now)),
    ];

    // Claim the numbers before anything else: once a code is in the tracker
    // it must never be handed out again, even if this run crashes mid-write.
    await saveState({
        date: today,
        used: [...used].sort((a, b) => a - b),
    });

    const runId = newRunId();

    console.log(`\n── Intake file creation · ${runId} ──────────────────────────`);
    await tracker.register(
        planned.map((file) => ({
            controlCode: file.filename,
            runId,
            channelDir: file.channelDir,
            paymentChannel: file.paymentMode,
            claimRows: file.rows.map((row, i) => ({ rowNumber: i + 1, transactionId: row.transactionId, actionMemo: row.actionMemo })),
        })),
        TRACKER_ACTOR,
        { creationStatus: 'IN_PROGRESS' }
    );
    console.log(`[EXECUTING] ${planned.length} control code(s) registered in the tracker as S0 IN_PROGRESS`);
    console.log(`            ${tracker.filePath}`);

    const written: GeneratedIntakeFile[] = [];
    const failed: string[] = [];

    for (const file of planned) {
        const outPath = path.join(file.channelDir, `${file.filename}.xlsx`);
        try {
            await mkdir(file.channelDir, { recursive: true });
            await buildWorkbook(file, visitDate, receivedDate).xlsx.writeFile(outPath);
        } catch (err) {
            // Keep going: one unwritable file shouldn't leave the rest of the
            // batch stuck IN_PROGRESS in the tracker.
            failed.push(file.filename);
            await tracker.failStage(file.filename, 'S0_INTAKE_CREATION', TRACKER_ACTOR, summarizeError(err));
            console.log(`  ✗ ${describeFile(file)}  — ${summarizeError(err)}`);
            continue;
        }

        await tracker.passStage(file.filename, 'S0_INTAKE_CREATION', TRACKER_ACTOR, {
            fields: { intakeFileName: `${file.filename}.xlsx` },
            detail: repoRelative(outPath),
        });
        written.push({ controlCode: file.filename, paymentMode: file.paymentMode, filePath: outPath, negative: file.negative });
        console.log(`  ✓ ${describeFile(file)}  → ${repoRelative(outPath)}`);
    }

    console.log(`[DONE] ${written.length} intake file(s) created, ${failed.length} failed — tracker S0 updated`);
    if (failed.length > 0) {
        throw new Error(`Intake file creation failed for ${failed.join(', ')} — see the tracker's Event Log.`);
    }
    console.log('       Next: npx playwright test tests/IntakeUpload.spec.ts\n');
    return written;
}

// Runs automatically only when invoked directly (`node scripts/generate-intake-batches.ts`),
// not when imported as a module (e.g. by tests/IntakeUpload.spec.ts). process.argv[1] is
// undefined in some non-direct-invocation contexts (e.g. `node -e`) — treat that the same
// as "not a direct run" rather than letting pathToFileURL throw on it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await generateIntakeBatches();
}
