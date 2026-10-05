// Generates OPEML claim-upload test data for the three payment modes (DPS,
// ComCheck, UB/UnionBank), as two batches:
//
//   - NEGATIVE batch (OPEML2026092900428T/429T/430T): every row has
//     Action Memo = "Y" and blank Diagnosis/Dx Code, so the upload is
//     expected to fail.
//   - POSITIVE batch (OPEML2026092900431T/432T/433T): same doctor-per-
//     payment-mode mapping and column structure, but complete fields
//     (Action Memo = "N", Diagnosis/Dx Code filled in) and different
//     patients, with Member Code / Transaction ID / file counter all
//     incremented from the negative batch.
//
// Schema, column widths, and the fixed test-environment values (Source
// System, Approval No, OTP, PF Amount, Claim Type, Procedure, Care Setting,
// Claim Sub Type) are copied from the reference files
// OPEML2026092900428T/429T/430T.xlsx in the repo root.
//
// Patient names/member codes are synthetic placeholders ("Juan/Maria Dela
// Cruz", "Pedro/Ana Santos" — the same placeholder convention already used
// in tests/ClaimsCapture.spec.ts), not the real member data the reference
// files originally contained — per policy, customer PII is never written
// into generated test data. Doctor names are kept as-is: they are the
// system's own physician/payment-mode routing reference data, which is the
// actual thing under test here, not patient PII.
//
// Usage:
//     node scripts/generate-opeml-batches.ts
//
// Output:
//     test-data/opeml/OPEML2026092900428T.xlsx  (DPS,      negative)
//     test-data/opeml/OPEML2026092900429T.xlsx  (ComCheck, negative)
//     test-data/opeml/OPEML2026092900430T.xlsx  (UB,       negative)
//     test-data/opeml/OPEML2026092900431T.xlsx  (DPS,      positive)
//     test-data/opeml/OPEML2026092900432T.xlsx  (ComCheck, positive)
//     test-data/opeml/OPEML2026092900433T.xlsx  (UB,       positive)

import ExcelJS from 'exceljs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(__dirname);
const OUTPUT_DIR = path.join(REPO_ROOT, 'test-data', 'opeml');

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

// Reference files' Consultation/Transaction IDs ran
// 69f1743bfba5000dc5bc5600 .. 69f1743bfba5000dc5bc5605 (2 rows x 3 files).
// Continue that same hex sequence for the generated batches below.
const TRANSACTION_ID_PREFIX = '69f1743bfba5000dc5bc';
let nextTransactionSuffix = 0x5606;

function nextTransactionId(): string {
    const txnId = `${TRANSACTION_ID_PREFIX}${nextTransactionSuffix.toString(16).padStart(4, '0')}`;
    nextTransactionSuffix += 1;
    return txnId;
}

type Patient = { memberCode: number; name: string };

// Synthetic placeholder patients only — never the real member data the
// reference files originally carried. Negative and positive batches use
// different patients, per the brief ("different patient" for the positive
// batch).
const NEGATIVE_PATIENTS: Patient[] = [
    { memberCode: 90000001, name: 'JUAN DELA CRUZ' },
    { memberCode: 90000002, name: 'MARIA DELA CRUZ' },
];
const POSITIVE_PATIENTS: Patient[] = [
    { memberCode: 90000003, name: 'PEDRO SANTOS' },
    { memberCode: 90000004, name: 'ANA SANTOS' },
];

// Generic clinical reference codes (not patient-identifying) — reused from
// the reference files for the positive/complete batch.
const SAMPLE_DIAGNOSES = [
    { diagnosis: 'Acute upper respiratory infection', dxCode: 'Dx2473' },
    { diagnosis: 'Eczema', dxCode: 'Dx3632' },
];

type BatchEntry = { filename: string; paymentMode: PaymentMode };

const NEGATIVE_BATCH: BatchEntry[] = [
    { filename: 'OPEML2026092900428T', paymentMode: 'DPS' },
    { filename: 'OPEML2026092900429T', paymentMode: 'COMCHECK' },
    { filename: 'OPEML2026092900430T', paymentMode: 'UB' },
];
const POSITIVE_BATCH: BatchEntry[] = [
    { filename: 'OPEML2026092900431T', paymentMode: 'DPS' },
    { filename: 'OPEML2026092900432T', paymentMode: 'COMCHECK' },
    { filename: 'OPEML2026092900433T', paymentMode: 'UB' },
];

const VISIT_DATE = '09/29/2026';
const RECEIVED_DATE = '09/29/2026';
const VISIT_TIMES = ['12:46:50', '12:46:51'];

// Match the reference files' column widths so the generated sheet looks the
// same, not just carries the same data.
const COLUMN_WIDTHS = [
    10.06, 23.7, 9.52, 29.4, 27.54, 13.0,
    13.87, 11.94, 17.11, 26.12, 20.61, 5.82,
    4.6, 20.38, 4.6, 15.73, 18.68, 4.24,
    14.54, 9.18,
];

function buildWorkbook(filename: string, paymentMode: PaymentMode, patients: Patient[], negative: boolean): ExcelJS.Workbook {
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
            VISIT_DATE,
            VISIT_TIMES[i % VISIT_TIMES.length],
            nextTransactionId(),
            COMMON_FIELDS.approvalNo,
            COMMON_FIELDS.otp,
            COMMON_FIELDS.pfAmount,
            filename,
            COMMON_FIELDS.claimType,
            COMMON_FIELDS.procedure,
            RECEIVED_DATE,
            COMMON_FIELDS.careSetting,
            COMMON_FIELDS.claimSubType,
            actionMemo,
        ]);
    });

    return workbook;
}

async function writeBatch(batch: BatchEntry[], patients: Patient[], negative: boolean): Promise<void> {
    for (const entry of batch) {
        const workbook = buildWorkbook(entry.filename, entry.paymentMode, patients, negative);
        const outPath = path.join(OUTPUT_DIR, `${entry.filename}.xlsx`);
        await workbook.xlsx.writeFile(outPath);
        console.log(`Wrote ${negative ? 'negative' : 'positive'} batch file: ${outPath}`);
    }
}

async function main(): Promise<void> {
    await mkdir(OUTPUT_DIR, { recursive: true });

    await writeBatch(NEGATIVE_BATCH, NEGATIVE_PATIENTS, true);
    await writeBatch(POSITIVE_BATCH, POSITIVE_PATIENTS, false);
}

await main();
