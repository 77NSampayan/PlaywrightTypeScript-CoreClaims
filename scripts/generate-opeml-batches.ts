// Generates OPEML claim-upload test data for the three payment modes (DPS,
// ComCheck, UB/UnionBank), as two batches:
//
//   - NEGATIVE batch (first 3 files): every row has Action Memo = "Y" and
//     blank Diagnosis/Dx Code, so the upload is expected to fail.
//   - POSITIVE batch (next 3 files): same doctor-per-payment-mode mapping
//     and column structure, but complete fields (Action Memo = "N",
//     Diagnosis/Dx Code filled in) and different patients.
//
// Filenames are OPEML<today's date, YYYYMMDD><5-digit running counter>T —
// the counter continues across runs on the same day (persisted in
// .opeml-sequence-state.json, next to this script) and resets to 1 the
// first time the script runs on a new day. Deleting generated files under
// test-data/opeml/ does not affect this — the counter lives in the state
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
//     node scripts/generate-opeml-batches.ts
//
// Output (example, run on 2026-10-05, first run of the day):
//     test-data/opeml/OPEML2026100500001T.xlsx  (DPS,      negative)
//     test-data/opeml/OPEML2026100500002T.xlsx  (ComCheck, negative)
//     test-data/opeml/OPEML2026100500003T.xlsx  (UB,       negative)
//     test-data/opeml/OPEML2026100500004T.xlsx  (DPS,      positive)
//     test-data/opeml/OPEML2026100500005T.xlsx  (ComCheck, positive)
//     test-data/opeml/OPEML2026100500006T.xlsx  (UB,       positive)

import ExcelJS from 'exceljs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(__dirname);
const OUTPUT_DIR = path.join(REPO_ROOT, 'test-data', 'opeml');
const STATE_FILE = path.join(__dirname, '.opeml-sequence-state.json');

const HEADERS = [
    'Member Code', 'Name', 'Company', 'Diagnosis', 'Dx Code', 'Doctor',
    'Source System', 'Visit Date', 'Visit Time', 'Consultation/Transaction ID',
    'Approval No', 'OTP', 'PF Amount', 'Control Code', 'Claim Type',
    'Procedure', 'Received Date', 'Care Setting', 'Claim Sub Type', 'Action Memo',
];

type PaymentMode = 'DPS' | 'COMCHECK' | 'UB';

// Doctor name must match the live system's physician master data exactly,
// including the trailing space on two of these three (present in the
// reference files too) — the app looks the doctor up by this string, so a
// "cleaned up" name would silently break the payment-mode routing.
const PAYMENT_MODE_DOCTORS: Record<PaymentMode, string> = {
    DPS: 'TOMAS ANTONIO',
    COMCHECK: 'JAN ROSLYN T. EMPINADO ',
    UB: 'MA. TERESA VICTORIA LUCIA DIMAGIBA ',
};

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
// not under test-data/opeml/, so deleting generated output doesn't reset it.
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
    const now = new Date();
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

// "MEMBERS WITH ACTIVE POLICY IN STAGING" fixture accounts (same family,
// account 01011999-000025) — confirmed by the test data owner to be
// synthetic QA fixtures, not real customers, so safe to use directly. These
// are also the only Member Codes the staging upload actually validates
// against, which a made-up code would not pass.
//
// Negative batch reuses the same two dependents (33725678/33725679) the
// original reference files (428T/429T/430T) already used. The positive
// batch brings in the family's principal member (33725677) as the
// genuinely "different" patient — only 3 confirmed-valid fixtures exist in
// total, so its second row reuses one dependent rather than inventing an
// unconfirmed code.
const NEGATIVE_PATIENTS: Patient[] = [
    { memberCode: 33725678, name: 'NIEVA DINGLASAN' },
    { memberCode: 33725679, name: 'ROMEO DINGLASAN' },
];
const POSITIVE_PATIENTS: Patient[] = [
    { memberCode: 33725677, name: 'ROVIE MAIDA A DINGLASAN' },
    { memberCode: 33725678, name: 'NIEVA DINGLASAN' },
];

// Generic clinical reference codes (not patient-identifying) — reused from
// the reference files for the positive/complete batch.
const SAMPLE_DIAGNOSES = [
    { diagnosis: 'Acute upper respiratory infection', dxCode: 'Dx2473' },
    { diagnosis: 'Eczema', dxCode: 'Dx3632' },
];

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

    const doctor = PAYMENT_MODE_DOCTORS[paymentMode];

    patients.forEach((patient, i) => {
        const diagnosis = negative ? '' : SAMPLE_DIAGNOSES[i % SAMPLE_DIAGNOSES.length]!.diagnosis;
        const dxCode = negative ? '' : SAMPLE_DIAGNOSES[i % SAMPLE_DIAGNOSES.length]!.dxCode;
        const actionMemo = negative ? 'Y' : 'N';

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

async function main(): Promise<void> {
    await mkdir(OUTPUT_DIR, { recursive: true });

    const state = await loadState();
    const now = new Date();
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

    await writeBatch(negativeBatch, NEGATIVE_PATIENTS, true, visitDate, receivedDate);
    await writeBatch(positiveBatch, POSITIVE_PATIENTS, false, visitDate, receivedDate);

    await saveState({
        date: today,
        lastCounter: counter,
    });
}

await main();
