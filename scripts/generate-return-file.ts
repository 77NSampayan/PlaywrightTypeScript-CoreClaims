// Generates the "Return File" for DPS and UB:
//   - DPS: transfer_money_export CSV, modeled on the real reference export
//     transfer_money_export_2026-10-05T10_31_18.370Z (1).csv and its
//     field-mapping screenshot.
//   - UB: PESONET_<MMDDYYYY>_<seq>_CLAIMS2_UBT.xlsx, modeled on its own
//     field-mapping screenshot ("Return File UB").
//
// EP Number / Transfer ID — per explicit instruction ("just generate for
// now ignore the EP Number for now that we will get in DB"), neither file
// queries the DB for this right now. fetchTransactionNo() (the real
// SELECT transaction_no FROM [dbo].[de_dps_input] WHERE control_no = ?
// query against the data_enrichment DB) is kept, exported, and unused —
// wire it back into generateDpsReturnFile()/generateUbReturnFile() once
// that lookup is wanted again.
//
// DPS field sourcing:
//   - Transaction ID: unique, generated here (DPS<9-digit counter>).
//   - DPS User Name: the doctor used in the DPS batch (PAYMENT_MODE_DOCTORS.DPS).
//   - Email / Mobile Number: DOCTOR_CONTACTS below — static, per explicit
//     instruction ("it will never change"), not a DB lookup.
//   - Date Requested / Date Approved/Rejected: current timestamp.
//   - Maker / Approver / No. of Approvals / Amount / Remaining Balance /
//     Status: fixed values copied from the real reference export.
//
// UB is NOT a flat one-row table — it's a report-style layout (Title / Header
// key-value section / Details mini-table), copied directly from the real
// reference export scripts/templates/ReturnFileUB_sample.xlsx
// (PESONET_10142026_001_CLAIMS2_UBT.xlsx), not reconstructed from the
// field-mapping screenshot alone (that led to a wrong first pass — see this
// file's git history). Section/row layout, fonts, and the orange "Header"/
// "Details" section-label color (FFFA4616) are all copied from that sample.
//
// Header section (rows 4-13, label in col A / value in col B):
//   - Company Name: fixed ("MEDICARD PHILIPPINES INC.").
//   - Source Account Number: fixed ("101240119030", "as is").
//   - Transaction Amount: the shared claim amount used throughout this
//     pipeline (997.5).
//   - Transaction Count: number of Details rows this run (always 1 here —
//     one beneficiary per file).
//   - Transaction Date: current timestamp — "Month<2 spaces>D, YYYY, H:MM AM/PM".
//     The double space after the month name is copied verbatim from the
//     real sample ("October  12, 2026, ..."), not a typo introduced here.
//   - Remarks: the output filename itself, without the extension.
//   - Remittance Type: fixed ("PESONet").
//   - Currency: fixed ("PHP").
//   - Transaction ID: "UBT1" + MMDDYY.
//   - Batch ID: "<YYMMDD>-FT<DD>QLVY" — same DD/suffix shape as Line ID
//     below (confirmed against the real sample: Batch ID "261014-FT14QLVY"
//     and Line ID "261014-FT14QLVY-00001" share the same "FT14QLVY" for
//     Oct 14 — NOT a fixed "FT29QLVY" as an earlier pass of this file
//     wrongly assumed from the screenshot alone).
//
// Details section (row 16 header, row 17 the one data row):
//   - Line ID: "<YYMMDD>-FT<DD>QLVY-<5-digit line counter>" ("00001" here —
//     always exactly one detail line).
//   - Transaction Status: fixed ("Transaction Successful").
//   - Beneficiary Name: the UB doctor's full name — per the original
//     field-mapping screenshot's explicit instruction, even though the real
//     sample happens to leave this blank.
//   - Beneficiary Code: blank (not specified anywhere; blank in the sample too).
//   - Beneficiary Account Number: "<YYMMDD><3-digit counter>", unique, per
//     the "YYMMDD+XXX" format note (not the field-mapping screenshot's own
//     sample value "370024175", which doesn't decompose that way, nor this
//     real sample's own value, which simply isn't in that shape either —
//     the format rule overrides any single literal example).
//   - Beneficiary Address: fixed ("MEDICARD MAKATI").
//   - Beneficiary Bank: fixed ("UNION BANK OF THE PHILS.").
//   - Beneficiary Bank Address: blank (blank in the sample).
//   - Beneficiary Bank Code: fixed ("010419995").
//   - Amount: same shared claim amount (997.5).
//   - Transaction Reason / Other Details / Remarks (all three identical,
//     confirmed against the real sample — not just two columns as an
//     earlier pass of this file assumed): "<MMDDYYYY><6-digit suffix> <EP
//     NUMBER> MEDICARD " (trailing space included, copied from the real
//     sample). The 6-digit suffix is random, not HHMMSS — the real sample's
//     own value ("123456") doesn't match its actual transaction time, so
//     it reads as an arbitrary-looking sequence rather than a timestamp.
//     EP NUMBER is blank for now (see the EP Number note above), leaving a
//     double space before "MEDICARD".
//   - Service Fee: fixed (0).
//   - Reason for Failure: blank (blank in the sample).
//
// Both depend on test-data/intake/ already having a *passing* (Action Memo =
// "N") OPEML row for the target payment mode — same self-healing precedent
// as the Payment Journal/Disbursement/F2307 generators.
//
// Usage:
//     node scripts/generate-return-file.ts
//     PAYMENT_MODE_FILTER=UB node scripts/generate-return-file.ts   # UB only
//
// Output:
//     test-data/return-file/transfer_money_export_<ISO timestamp>.csv        (DPS)
//     test-data/return-file/PESONET_<MMDDYYYY>_<seq>_CLAIMS2_UBT.xlsx        (UB)

import ExcelJS from 'exceljs';
import sql from 'mssql';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { generateIntakeBatches, isDoctorForMode, matchesPaymentModeFilter } from './generate-intake-batches.ts';
import { readPassingRows } from './generate-payment-journal.ts';
import { db_config } from '../playwright.config.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(__dirname);
const OUTPUT_DIR = path.join(REPO_ROOT, 'test-data', 'return-file');
const STATE_FILE = path.join(__dirname, '.return-file-sequence-state.json');

// Ad hoc "generate as if it were a different day" override — same pattern as
// every other generator in this pipeline.
function getToday(): Date {
    const override = process.env.FAKE_TODAY;
    if (override) {
        const parsed = new Date(`${override}T00:00:00`);
        if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
}

// Ad hoc "use this real EP Number" override — EP_NUMBER_DPS / EP_NUMBER_UB —
// for supplying an EP Number looked up by hand until fetchTransactionNo()
// is wired back in. Defaults to blank (the "ignore the EP Number for now"
// behavior), same override pattern as FAKE_TODAY/PAYMENT_MODE_FILTER.
function getEpNumberOverride(mode: 'DPS' | 'UB'): string {
    return process.env[`EP_NUMBER_${mode}`]?.trim() ?? '';
}

// Doctor contact info — confirmed static ("it will never change"), so stored
// here rather than queried. Mobile Number is kept in the real export's own
// "63" country-code format (no leading 0), matching the sample row's shape
// (639199934507), converted from the PNAS screenshot's local "0917..." form.
const DOCTOR_CONTACTS: Record<string, { email: string; mobile: string }> = {
    'TOMAS ANTONIO': { email: 'antoniotomastest@gmail.com', mobile: '639173236327' },
};

const DPS_HEADERS = [
    'Transaction ID', 'Transfer ID', 'DPS User Name', 'Email', 'Mobile Number',
    'Maker', 'Date Requested', 'Approver', 'Date Approved/Rejected',
    'No. of Approvals', 'Amount', 'Remaining Balance', 'Status',
];

// The Details section's 15 columns, in order — copied from
// scripts/templates/ReturnFileUB_sample.xlsx row 16.
const UB_DETAIL_HEADERS = [
    'Line ID', 'Transaction Status', 'Beneficiary Name', 'Beneficiary Code',
    'Beneficiary Account Number', 'Beneficiary Address', 'Beneficiary Bank',
    'Beneficiary Bank Address', 'Beneficiary Bank Code', 'Amount',
    'Transaction Reason', 'Other Details', 'Remarks', 'Service Fee', 'Reason for Failure',
];

// Column widths for the whole sheet — copied from the real sample (applies
// uniformly down the sheet; the Header section only uses the first 2).
const UB_COLUMN_WIDTHS = [
    26.09, 36.27, 46.63, 18.63, 30.63, 21.91, 26.45, 27.63,
    24.45, 12.09, 45.91, 45.91, 45.91, 13.18, 20.18,
];

const UB_SECTION_LABEL_COLOR = 'FFFA4616';

// The one shared claim amount reused across this whole pipeline (Payment
// Journal's COMMON_FIELDS.amount, DPS Return File's Amount, UB's Transaction
// Amount/Amount) — kept as its own named constant here since this file
// doesn't import generate-payment-journal.ts's private COMMON_FIELDS.
const CLAIM_AMOUNT = 997.5;

// Fixed values copied verbatim from the real reference export — not called
// out as variable by the field-mapping screenshot.
const DPS_COMMON_FIELDS = {
    maker: 'Joan Canave',
    approver: 'Raymundo Marras, Cristina Cuevas MD',
    noOfApprovals: 2,
    amount: CLAIM_AMOUNT,
    remainingBalance: 2021429.36,
    status: 'Approved',
};

// Fixed values copied verbatim from scripts/templates/ReturnFileUB_sample.xlsx.
const UB_COMMON_FIELDS = {
    companyName: 'MEDICARD PHILIPPINES INC.',
    sourceAccountNumber: 101240119030,
    remittanceType: 'PESONet',
    currency: 'PHP',
    transactionStatus: 'Transaction Successful',
    beneficiaryAddress: 'MEDICARD MAKATI',
    beneficiaryBank: 'UNION BANK OF THE PHILS.',
    beneficiaryBankCode: '010419995',
    serviceFee: 0,
};

type SequenceState = {
    /** YYYYMMDD of the last run — a new day resets every counter below. */
    date: string;
    /** DPS Transaction ID counter. */
    lastCounter: number;
    /** UB Beneficiary Account Number counter — resets to 0 each new day. */
    ubAccountCounter: number;
    /** UB Line ID counter — resets to 0 each new day; always 1 per run today. */
    ubLineCounter: number;
};

function todayYyyyMmDd(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}${month}${day}`;
}

// 9-digit random base, comfortably clear of the real sample's range
// (~000004xxx) — same "stay far from a real production sequence" reasoning
// as Payment Journal's randomFiveDigitBase().
function randomNineDigitBase(): number {
    return Math.floor(Math.random() * 900_000_000) + 900_000_000;
}

async function loadState(): Promise<SequenceState> {
    const today = todayYyyyMmDd(getToday());
    try {
        const raw = await readFile(STATE_FILE, 'utf-8');
        const state = JSON.parse(raw) as SequenceState;
        if (state.date === today) return state;
    } catch {
        // no state file yet — fall through to a fresh one below
    }
    return { date: today, lastCounter: randomNineDigitBase(), ubAccountCounter: 0, ubLineCounter: 0 };
}

async function saveState(state: SequenceState): Promise<void> {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function nextDpsTransactionId(state: SequenceState): string {
    state.lastCounter += 1;
    return `DPS${String(state.lastCounter).padStart(9, '0')}`;
}

function nextUbAccountSuffix(state: SequenceState): string {
    state.ubAccountCounter += 1;
    return String(state.ubAccountCounter).padStart(3, '0');
}

function nextUbLineSuffix(state: SequenceState): string {
    state.ubLineCounter += 1;
    return String(state.ubLineCounter).padStart(5, '0');
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

// "October 5, 2026 at 10:42 AM" — matches the DPS real export's own timestamp shape.
function formatDpsTimestamp(date: Date): string {
    const month = MONTH_NAMES[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${month} ${day}, ${year} at ${hours}:${minutes} ${ampm}`;
}

// "September 29, 2026, 12:57 PM" — matches the UB field-mapping screenshot's
// own sample format (comma before the time, no "at", unlike DPS's).
// The double space after the month name ("October  12, 2026, ...") is
// copied verbatim from the real sample, not a typo introduced here.
function formatUbTimestamp(date: Date): string {
    const month = MONTH_NAMES[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${month}  ${day}, ${year}, ${hours}:${minutes} ${ampm}`;
}

function mmddyyyy(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}${day}${date.getFullYear()}`;
}

function mmddyy(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${month}${day}${year}`;
}

function yymmdd(date: Date): string {
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

// Random, not a timestamp — the real sample's own value ("123456" against a
// transaction logged at 08:27 PM) doesn't line up with HHMMSS, so this reads
// as an arbitrary 6-digit sequence rather than the time of day.
function randomSixDigits(): string {
    return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

// Minimal CSV field escaping — quote and double-up internal quotes whenever a
// field contains a comma, quote, or newline (the real export itself quotes
// "Raymundo Marras, Cristina Cuevas MD" and the "Month D, YYYY at ..." dates
// this same way).
function csvField(value: string | number): string {
    const text = String(value);
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

// The real DB lookup for the EP Number ("Transfer ID") — SELECT transaction_no
// FROM [dbo].[de_dps_input] WHERE control_no = ?, against the data_enrichment
// DB. Exported but currently unused: per explicit instruction, both return
// files skip this for now and leave the EP Number blank. Re-wire this into
// generateDpsReturnFile()/generateUbReturnFile() once that lookup is wanted.
export async function fetchTransactionNo(controlCode: string): Promise<string | null> {
    const pool = await new sql.ConnectionPool({
        server: db_config.server,
        database: db_config.database,
        user: db_config.user,
        password: db_config.password,
        port: db_config.port,
        options: { encrypt: true, trustServerCertificate: false },
    }).connect();

    try {
        const result = await pool
            .request()
            .input('controlNo', sql.VarChar, controlCode)
            .query('SELECT transaction_no FROM [dbo].[de_dps_input] WHERE control_no = @controlNo');
        const row = result.recordset[0] as { transaction_no?: string } | undefined;
        return row?.transaction_no ?? null;
    } finally {
        await pool.close();
    }
}

export async function generateDpsReturnFile(): Promise<void> {
    if (!matchesPaymentModeFilter('DPS')) {
        console.log('PAYMENT_MODE_FILTER excludes DPS — skipping the DPS Return File.');
        return;
    }

    await mkdir(OUTPUT_DIR, { recursive: true });

    // Not "rows.length === 0" — test-data/intake/ can have rows from
    // unrelated/stale files (a different doctor entirely) without having one
    // for DPS specifically.
    let passingRows = await readPassingRows();
    let match = passingRows.find((row) => isDoctorForMode(row.doctor, 'DPS'));
    if (!match) {
        await generateIntakeBatches();
        passingRows = await readPassingRows();
        match = passingRows.find((row) => isDoctorForMode(row.doctor, 'DPS'));
    }

    if (!match) {
        throw new Error('No passing OPEML row found for DPS — nothing to reference.');
    }

    const contact = DOCTOR_CONTACTS[match.doctor];
    if (!contact) {
        throw new Error(`No stored email/mobile for DPS doctor "${match.doctor}" — add it to DOCTOR_CONTACTS.`);
    }

    const state = await loadState();
    const transactionId = nextDpsTransactionId(state);
    const now = getToday();
    const timestamp = formatDpsTimestamp(now);

    // EP Number ("Transfer ID") — blank by default (see the header comment
    // and fetchTransactionNo()'s own comment), or EP_NUMBER_DPS if supplied.
    const transferId = getEpNumberOverride('DPS');

    const row = [
        transactionId,
        transferId,
        match.doctor,
        contact.email,
        contact.mobile,
        DPS_COMMON_FIELDS.maker,
        timestamp,
        DPS_COMMON_FIELDS.approver,
        timestamp,
        DPS_COMMON_FIELDS.noOfApprovals,
        DPS_COMMON_FIELDS.amount,
        DPS_COMMON_FIELDS.remainingBalance,
        DPS_COMMON_FIELDS.status,
    ];

    const csv = `${DPS_HEADERS.join(',')}\n${row.map(csvField).join(',')}\n`;

    const isoSlug = now.toISOString().replace(/:/g, '_');
    const outPath = path.join(OUTPUT_DIR, `transfer_money_export_${isoSlug}.csv`);
    await writeFile(outPath, csv);
    console.log(`Wrote DPS Return File: ${outPath}`);

    await saveState(state);
}

const HEADER_LABEL_FONT = { bold: true, size: 11, name: 'Calibri', family: 2 as const };
const HEADER_VALUE_FONT = { size: 11, name: 'Calibri', family: 2 as const };
const SECTION_LABEL_FONT = { bold: true, size: 12, name: 'Calibri', family: 2 as const, color: { argb: UB_SECTION_LABEL_COLOR } };
const DETAIL_HEADER_FONT = { bold: true, size: 11, name: 'Calibri', family: 2 as const };
const DETAIL_VALUE_FONT = { size: 11, name: 'Aptos Narrow', family: 2 as const, color: { argb: 'FF000000' } };

function setHeaderField(sheet: ExcelJS.Worksheet, row: number, label: string, value: string | number): void {
    const labelCell = sheet.getCell(row, 1);
    labelCell.value = label;
    labelCell.font = HEADER_LABEL_FONT;

    const valueCell = sheet.getCell(row, 2);
    valueCell.value = value;
    valueCell.font = HEADER_VALUE_FONT;
}

export async function generateUbReturnFile(): Promise<void> {
    if (!matchesPaymentModeFilter('UB')) {
        console.log('PAYMENT_MODE_FILTER excludes UB — skipping the UB Return File.');
        return;
    }

    await mkdir(OUTPUT_DIR, { recursive: true });

    // Not "rows.length === 0" — same self-healing precedent as every other
    // generator here.
    let passingRows = await readPassingRows();
    let match = passingRows.find((row) => isDoctorForMode(row.doctor, 'UB'));
    if (!match) {
        await generateIntakeBatches();
        passingRows = await readPassingRows();
        match = passingRows.find((row) => isDoctorForMode(row.doctor, 'UB'));
    }

    if (!match) {
        throw new Error('No passing OPEML row found for UB — nothing to reference.');
    }

    const state = await loadState();
    const now = getToday();

    const filenameDate = mmddyyyy(now);
    const accountSuffix = nextUbAccountSuffix(state);
    const lineSuffix = nextUbLineSuffix(state);
    const fileSeq = String(state.ubAccountCounter).padStart(3, '0');
    const baseName = `PESONET_${filenameDate}_${fileSeq}_CLAIMS2_UBT`;

    const dd = String(now.getDate()).padStart(2, '0');
    const batchIdSuffix = `FT${dd}QLVY`;
    const lineId = `${yymmdd(now)}-${batchIdSuffix}-${lineSuffix}`;

    // EP Number — blank by default (see header comment, reads as a double
    // space before "MEDICARD" even then), or EP_NUMBER_UB if supplied.
    const epNumber = getEpNumberOverride('UB');
    const transactionReason = `${mmddyyyy(now)}${randomSixDigits()} ${epNumber} MEDICARD `;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Transactions');
    sheet.columns = UB_COLUMN_WIDTHS.map((width) => ({ width }));

    const titleCell = sheet.getCell(1, 1);
    titleCell.value = 'Portal Interbank Transaction';
    titleCell.font = { bold: true, size: 14, name: 'Calibri', family: 2 };
    sheet.mergeCells(1, 1, 1, 3);

    const headerLabel = sheet.getCell(3, 1);
    headerLabel.value = 'Header';
    headerLabel.font = SECTION_LABEL_FONT;

    setHeaderField(sheet, 4, 'Company Name', UB_COMMON_FIELDS.companyName);
    setHeaderField(sheet, 5, 'Source Account Number', UB_COMMON_FIELDS.sourceAccountNumber);
    setHeaderField(sheet, 6, 'Transaction Amount', CLAIM_AMOUNT);
    setHeaderField(sheet, 7, 'Transaction Count', 1); // one Details row per run
    setHeaderField(sheet, 8, 'Transaction Date', formatUbTimestamp(now));
    setHeaderField(sheet, 9, 'Remarks', baseName);
    setHeaderField(sheet, 10, 'Remittance Type', UB_COMMON_FIELDS.remittanceType);
    setHeaderField(sheet, 11, 'Currency', UB_COMMON_FIELDS.currency);
    setHeaderField(sheet, 12, 'Transaction ID', `UBT1${mmddyy(now)}`);
    setHeaderField(sheet, 13, 'Batch ID', `${yymmdd(now)}-${batchIdSuffix}`);

    const detailsLabel = sheet.getCell(15, 1);
    detailsLabel.value = 'Details';
    detailsLabel.font = SECTION_LABEL_FONT;

    const headerRow = sheet.getRow(16);
    UB_DETAIL_HEADERS.forEach((header, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = header;
        cell.font = DETAIL_HEADER_FONT;
    });

    const dataRow = sheet.getRow(17);
    const detailValues = [
        lineId,
        UB_COMMON_FIELDS.transactionStatus,
        match.doctor.trim(), // Beneficiary Name — blank in the real sample, filled in per the field-mapping instruction
        null, // Beneficiary Code
        `${yymmdd(now)}${accountSuffix}`,
        UB_COMMON_FIELDS.beneficiaryAddress,
        UB_COMMON_FIELDS.beneficiaryBank,
        null, // Beneficiary Bank Address
        UB_COMMON_FIELDS.beneficiaryBankCode,
        CLAIM_AMOUNT,
        transactionReason,
        transactionReason, // Other Details — identical to Transaction Reason
        transactionReason, // Remarks (Details-row) — identical to Transaction Reason
        UB_COMMON_FIELDS.serviceFee,
        null, // Reason for Failure
    ];
    detailValues.forEach((value, i) => {
        const cell = dataRow.getCell(i + 1);
        cell.value = value;
        cell.font = DETAIL_VALUE_FONT;
    });

    const outPath = path.join(OUTPUT_DIR, `${baseName}.xlsx`);
    await workbook.xlsx.writeFile(outPath);
    console.log(`Wrote UB Return File: ${outPath}`);

    await saveState(state);
}

export async function generateReturnFiles(): Promise<void> {
    await generateDpsReturnFile();
    await generateUbReturnFile();
}

// Runs automatically only when invoked directly (`node scripts/generate-return-file.ts`),
// not when imported as a module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await generateReturnFiles();
}
