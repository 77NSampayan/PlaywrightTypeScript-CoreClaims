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
// Filenames are OPEML<today's date, YYYYMMDD><5-digit running counter>T —
// the counter continues across runs on the same day (persisted in
// .intake-sequence-state.json, next to this script) and resets to 1 the
// first time the script runs on a new day. Deleting generated files under
// test-data/intake/ does not affect this — the counter lives in the state
// file, not the output directory.
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
//
// Output (example, run on 2026-10-05, first run of the day):
//     test-data/intake/OPEML2026100500001T.xlsx  (DPS,      negative)
//     test-data/intake/OPEML2026100500002T.xlsx  (ComCheck, negative)
//     test-data/intake/OPEML2026100500003T.xlsx  (UB,       negative)
//     test-data/intake/OPEML2026100500004T.xlsx  (DPS,      positive)
//     test-data/intake/OPEML2026100500005T.xlsx  (ComCheck, positive)
//     test-data/intake/OPEML2026100500006T.xlsx  (UB,       positive)

import ExcelJS from 'exceljs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(__dirname);
const OUTPUT_DIR = path.join(REPO_ROOT, 'test-data', 'intake');
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

// Doctor name(s) must match the live system's physician master data exactly,
// including the trailing space on some of these (present in the reference
// files too) — the app looks the doctor up by this string, so a "cleaned
// up" name would silently break the payment-mode routing.
//
// ComCheck has exactly one valid doctor — VILLANUEVA, PURA CORAZON REYES.
// JAN ROSLYN T. EMPINADO was removed per explicit instruction; the array
// shape (rather than a single string) is kept for all three modes so
// pickDoctor()/isDoctorForMode() stay generic if a mode ever needs more
// than one again.
export const PAYMENT_MODE_DOCTORS: Record<PaymentMode, string[]> = {
    DPS: ['TOMAS ANTONIO'],
    COMCHECK: ['VILLANUEVA, PURA CORAZON REYES'],
    UB: ['MA. TERESA VICTORIA LUCIA DIMAGIBA '],
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

// Persisted across runs so the filename counter keeps advancing instead of
// restarting from the reference files every time. Lives next to the script,
// not under test-data/intake/, so deleting generated output doesn't reset it.
type SequenceState = {
    /** YYYYMMDD of the last run — the counter resets to 1 the first run on a new date. */
    date: string;
    /** Last filename counter used on `date`. */
    lastCounter: number;
};

async function loadState(): Promise<SequenceState> {
    try {
        const raw = await readFile(STATE_FILE, 'utf-8');
        return JSON.parse(raw) as SequenceState;
    } catch {
        return { date: '', lastCounter: 0 };
    }
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

function buildFilename(date: string, counter: number): string {
    return `OPEML${date}${String(counter).padStart(5, '0')}T`;
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

function buildWorkbook(filename: string, paymentMode: PaymentMode, patients: Patient[], negative: boolean, visitDate: string, receivedDate: string): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(filename);

    sheet.columns = HEADERS.map((header, i) => ({ header, width: COLUMN_WIDTHS[i]! }));

    const doctor = pickDoctor(paymentMode);

    patients.forEach((patient, i) => {
        // In a negative-batch file, only the 2nd row is the deliberate
        // failure (blank Diagnosis/Dx Code, Action Memo = "Y") — the 1st row
        // is complete and passing, so the file isn't "every row fails."
        // Positive batches are unaffected: every row stays complete/"N".
        const rowFails = negative && i > 0;
        const diagnosis = rowFails ? '' : SAMPLE_DIAGNOSIS.diagnosis;
        const dxCode = rowFails ? '' : SAMPLE_DIAGNOSIS.dxCode;
        const actionMemo = rowFails ? 'Y' : 'N';

        sheet.addRow([
            patient.memberCode,
            patient.name,
            COMMON_FIELDS.company,
            diagnosis,
            dxCode,
            doctor,
            COMMON_FIELDS.sourceSystem,
            visitDate,
            VISIT_TIMES[i % VISIT_TIMES.length],
            nextTransactionId(),
            COMMON_FIELDS.approvalNo,
            COMMON_FIELDS.otp,
            COMMON_FIELDS.pfAmount,
            filename,
            COMMON_FIELDS.claimType,
            COMMON_FIELDS.procedure,
            receivedDate,
            COMMON_FIELDS.careSetting,
            COMMON_FIELDS.claimSubType,
            actionMemo,
        ]);
    });

    return workbook;
}

async function writeBatch(batch: BatchEntry[], patients: Patient[], negative: boolean, visitDate: string, receivedDate: string): Promise<void> {
    for (const entry of batch) {
        const workbook = buildWorkbook(entry.filename, entry.paymentMode, patients, negative, visitDate, receivedDate);
        const outPath = path.join(OUTPUT_DIR, `${entry.filename}.xlsx`);
        await workbook.xlsx.writeFile(outPath);
        console.log(`Wrote ${negative ? 'negative' : 'positive'} batch file: ${outPath}`);
    }
}

// Exported so tests/IntakeUpload.spec.ts can call it directly (generate a
// sample file on demand when test-data/intake/ is empty) instead of
// requiring a separate manual `node scripts/generate-intake-batches.ts` step.
export async function generateIntakeBatches(): Promise<void> {
    await mkdir(OUTPUT_DIR, { recursive: true });

    const state = await loadState();
    const now = getToday();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const today = todayYyyyMmDd();
    // Visit Date is the day before the claim is received/uploaded.
    const visitDate = formatMmDdYyyy(yesterday);
    const receivedDate = formatMmDdYyyy(now);

    // New day — the filename counter starts over at 1. Same day — continue
    // from wherever the last run left off.
    let counter = state.date === today ? state.lastCounter : 0;

    const negativeBatch: BatchEntry[] = PAYMENT_MODE_ORDER.map((paymentMode) => {
        counter += 1;
        return { filename: buildFilename(today, counter), paymentMode };
    });
    const positiveBatch: BatchEntry[] = PAYMENT_MODE_ORDER.map((paymentMode) => {
        counter += 1;
        return { filename: buildFilename(today, counter), paymentMode };
    });

    const negativePatients = pickRandomPatients(2);
    const positivePatients = pickRandomPatients(2, negativePatients);

    await writeBatch(negativeBatch, negativePatients, true, visitDate, receivedDate);
    await writeBatch(positiveBatch, positivePatients, false, visitDate, receivedDate);

    await saveState({
        date: today,
        lastCounter: counter,
    });
}

// Runs automatically only when invoked directly (`node scripts/generate-intake-batches.ts`),
// not when imported as a module (e.g. by tests/IntakeUpload.spec.ts). process.argv[1] is
// undefined in some non-direct-invocation contexts (e.g. `node -e`) — treat that the same
// as "not a direct run" rather than letting pathToFileURL throw on it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await generateIntakeBatches();
}
