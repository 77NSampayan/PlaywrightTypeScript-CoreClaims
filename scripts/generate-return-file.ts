// Generates the DPS "Return File" (transfer_money_export CSV), modeled on the
// real reference export transfer_money_export_2026-10-05T10_31_18.370Z (1).csv
// and its field-mapping screenshot. UB's equivalent is a different file —
// not built yet, pending its own field mapping.
//
// Field sourcing, per the field-mapping screenshot and explicit instruction:
//   - Transaction ID: unique, generated here (DPS<9-digit counter>).
//   - Transfer ID ("EP number"): a REAL DB lookup, not synthetic —
//     SELECT transaction_no FROM [dbo].[de_dps_input] WHERE control_no = ?
//     against the data_enrichment DB (db_config), keyed by the DPS row's own
//     Control Code.
//   - DPS User Name: the doctor used in the DPS batch (PAYMENT_MODE_DOCTORS.DPS).
//   - Email / Mobile Number: DOCTOR_CONTACTS below — static, per explicit
//     instruction ("it will never change"), not a DB lookup.
//   - Date Requested / Date Approved/Rejected: current timestamp.
//   - Maker / Approver / No. of Approvals / Amount / Remaining Balance /
//     Status: fixed values copied from the real reference export — not
//     flagged as variable by the field-mapping screenshot.
//
// This depends on test-data/intake/ already having a *passing* (Action Memo =
// "N") OPEML row for DPS — same self-healing precedent as the Payment
// Journal/Disbursement/F2307 generators.
//
// Usage:
//     node scripts/generate-return-file.ts
//
// Output:
//     test-data/return-file/transfer_money_export_<ISO timestamp>.csv

import sql from 'mssql';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { generateIntakeBatches, isDoctorForMode } from './generate-intake-batches.ts';
import { readPassingRows } from './generate-payment-journal.ts';
import { db_config } from '../playwright.config.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(__dirname);
const OUTPUT_DIR = path.join(REPO_ROOT, 'test-data', 'return-file');
const STATE_FILE = path.join(__dirname, '.return-file-sequence-state.json');

// Doctor contact info — confirmed static ("it will never change"), so stored
// here rather than queried. Mobile Number is kept in the real export's own
// "63" country-code format (no leading 0), matching the sample row's shape
// (639199934507), converted from the PNAS screenshot's local "0917..." form.
const DOCTOR_CONTACTS: Record<string, { email: string; mobile: string }> = {
    'TOMAS ANTONIO': { email: 'antoniotomastest@gmail.com', mobile: '639173236327' },
};

const HEADERS = [
    'Transaction ID', 'Transfer ID', 'DPS User Name', 'Email', 'Mobile Number',
    'Maker', 'Date Requested', 'Approver', 'Date Approved/Rejected',
    'No. of Approvals', 'Amount', 'Remaining Balance', 'Status',
];

// Fixed values copied verbatim from the real reference export — not called
// out as variable by the field-mapping screenshot.
const COMMON_FIELDS = {
    maker: 'Joan Canave',
    approver: 'Raymundo Marras, Cristina Cuevas MD',
    noOfApprovals: 2,
    amount: 997.5,
    remainingBalance: 2021429.36,
    status: 'Approved',
};

type SequenceState = {
    /** YYYYMMDD of the last run — a new day picks a fresh random base. */
    date: string;
    lastCounter: number;
};

function todayYyyyMmDd(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}${month}${day}`;
}

// 9-digit random base, comfortably clear of the real sample's range
// (~000004xxx) — same "stay far from a real production sequence" reasoning
// as Payment Journal's randomFiveDigitBase().
function randomNineDigitBase(): number {
    return Math.floor(Math.random() * 900_000_000) + 900_000_000;
}

async function loadState(): Promise<SequenceState> {
    const today = todayYyyyMmDd();
    try {
        const raw = await readFile(STATE_FILE, 'utf-8');
        const state = JSON.parse(raw) as SequenceState;
        if (state.date === today) return state;
    } catch {
        // no state file yet — fall through to a fresh one below
    }
    return { date: today, lastCounter: randomNineDigitBase() };
}

async function saveState(state: SequenceState): Promise<void> {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function nextTransactionId(state: SequenceState): string {
    state.lastCounter += 1;
    return `DPS${String(state.lastCounter).padStart(9, '0')}`;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

// "October 5, 2026 at 10:42 AM" — matches the real export's own timestamp shape.
function formatTimestamp(date: Date): string {
    const month = MONTH_NAMES[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${month} ${day}, ${year} at ${hours}:${minutes} ${ampm}`;
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

async function fetchTransactionNo(controlCode: string): Promise<string | null> {
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

export async function generateReturnFile(): Promise<void> {
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

    const transferId = await fetchTransactionNo(match.controlCode);
    if (!transferId) {
        throw new Error(
            `No transaction_no found in [dbo].[de_dps_input] for control_no = "${match.controlCode}".`
        );
    }

    const contact = DOCTOR_CONTACTS[match.doctor];
    if (!contact) {
        throw new Error(`No stored email/mobile for DPS doctor "${match.doctor}" — add it to DOCTOR_CONTACTS.`);
    }

    const state = await loadState();
    const transactionId = nextTransactionId(state);
    const now = new Date();
    const timestamp = formatTimestamp(now);

    const row = [
        transactionId,
        transferId,
        match.doctor,
        contact.email,
        contact.mobile,
        COMMON_FIELDS.maker,
        timestamp,
        COMMON_FIELDS.approver,
        timestamp,
        COMMON_FIELDS.noOfApprovals,
        COMMON_FIELDS.amount,
        COMMON_FIELDS.remainingBalance,
        COMMON_FIELDS.status,
    ];

    const csv = `${HEADERS.join(',')}\n${row.map(csvField).join(',')}\n`;

    const isoSlug = now.toISOString().replace(/:/g, '_');
    const outPath = path.join(OUTPUT_DIR, `transfer_money_export_${isoSlug}.csv`);
    await writeFile(outPath, csv);
    console.log(`Wrote Return File: ${outPath}`);

    await saveState(state);
}

// Runs automatically only when invoked directly (`node scripts/generate-return-file.ts`),
// not when imported as a module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await generateReturnFile();
}
