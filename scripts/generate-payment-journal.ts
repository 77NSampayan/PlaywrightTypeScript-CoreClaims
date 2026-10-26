// Generates the "positive scenario" financial follow-up files for all three
// payment modes:
//   - DPS / UB: Payment Journal xlsx, modeled on the real reference files
//     DPS_PAYMENT JOURNAL_10.05.26.xlsx / UB_PAYMENT JOURNAL_10.06.26 (1).xlsx
//     (42-column schema, confirmed identical between the two) and the
//     field-mapping template screenshot for the per-payment-mode values.
//   - ComCheck: Disbursement File xlsx, modeled on the real reference file
//     10.06.26-PF-IP-MS-EFT_CNFHM (1).xlsx (6-column schema: check_no,
//     check_date, d_code, ctlno, found rec, bank).
//
// Both depend on the target payment mode's channel folder already having a
// *passing* (Action Memo = "N") OPEML row — "Reference Control No." /
// "ctlno" references that row's Control Code. Confirmed against the real UB
// Payment Journal template: its Reference Control No. (OPEML2026100600433T)
// is one of our own previously-generated positive-batch control codes, not a
// real customer transaction — this pipeline already uses the same synthetic
// OPEML data as everything else, the same way testblob does.
//
// ASSUMPTIONS flagged for confirmation (not yet confirmed by the test data
// owner, unlike everything else in this repo):
//   - Payment Journal's Document No. numeric suffix is a random 5-digit
//     number picked fresh each day and incremented within that day — not the
//     real sample's production-looking sequence (~0015xxx) — avoids any risk
//     of colliding with a real future NAV/Business Central document number.
//     See randomFiveDigitBase()/loadState().
//   - "new BOL Type" is "DPS" for DPS and "E-CREDIT" for UB (per explicit
//     instruction), not copied from the real UB sample's value verbatim —
//     that sample's internal content (CV-REGDPS doc. no., BOL type "DPS")
//     looks like an unedited copy of the DPS file despite being UB-named.
//   - Created By / Message to Recipient / Account No. use placeholders
//     rather than the real sample's values, which include a real
//     employee's Windows login and bank-account-shaped values.
//   - Disbursement File's d_code is fixed ("DR062016-0060", per explicit
//     instruction — "will always be the same it will not change"); check_no
//     is an independent day-reset incremental counter ("001T", "002T", ...),
//     also per explicit instruction — the real sample file's check_no
//     suffix happened to match its ctlno's own trailing digits, but that
//     wasn't the stated rule, so it's not relied on here.
//
// Usage:
//     node scripts/generate-payment-journal.ts
//     PAYMENT_MODE_FILTER=UB node scripts/generate-payment-journal.ts   # UB Payment Journal only, skips the ComCheck Disbursement File
//
// Output (written into the same channel/date folder as the intake row it
// references, alongside it — not a separate shared folder):
//     test-data/DPS/<MM.DD.YY>/DPS_PAYMENT_JOURNAL_01_<MM.DD.YY>.xlsx       (one per DPS Control Code found)
//     test-data/UB/<MM.DD.YY>/UB_PAYMENT_JOURNAL_01_<MM.DD.YY>.xlsx        (one per UB Control Code found)
//     test-data/COM CHECK/<MM.DD.YY>/<MM.DD.YY>-PF-IP-MS-EFT_01_COMCHECK.xlsx  (one per ComCheck Control Code found)

import ExcelJS from 'exceljs';
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { ALL_PAYMENT_MODES, filterPaymentModes, formatDateFolder, generateIntakeBatches, getChannelDir, isIntakeFilename, matchesPaymentModeFilter, type PaymentMode } from './generate-intake-batches.ts';
import { readFailedRows } from './generate-claim-memos.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.payment-journal-sequence-state.json');

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

type JournalPaymentMode = 'DPS' | 'UB';
const PAYMENT_MODES: JournalPaymentMode[] = ['DPS', 'UB'];

const DOCUMENT_NO_PREFIX: Record<JournalPaymentMode, string> = {
    DPS: 'CV-REGDPS-01-',
    UB: 'CV-REGECR-01-',
};

// "new BOL Type" column value — not always the same string as the payment
// mode itself (UB's is "E-CREDIT", per explicit instruction).
const NEW_BOL_TYPE: Record<JournalPaymentMode, string> = {
    DPS: 'DPS',
    UB: 'E-CREDIT',
};

// ComCheck's Disbursement File — d_code never changes, per explicit
// instruction.
const DISBURSEMENT_D_CODE = 'DR062016-0060';
const DISBURSEMENT_HEADERS = ['check_no', 'check_date', 'd_code', 'ctlno', 'found rec', 'bank'];

const HEADERS = [
    'Status', 'Posting Date', 'S No.', 'Check No.', 'Check Printed', 'Approver 1', 'Approver 2',
    'Document No.', 'Account No.', 'Reference Control No.', 'Amount', 'Applies-to Doc. No.',
    'Applies-to Doc. Due Date', 'Payment Method Code', 'Control Code', 'Digitized Check',
    'Payment Reference', 'Document Type', 'External Document No.', 'Account Type', 'Created By',
    'Recipient Bank Account', 'Message to Recipient', 'Description', 'Currency Code',
    'Bal. Account Type', 'Bal. Account No.', 'Applied (Yes/No)', 'Applies-to Doc. Type',
    'Applies-to ID', 'Bank Payment Type', 'Exported to Payment File', 'Total Exported Amount',
    'Has Payment Export Error', 'Processing Type', 'Printing Rule 2307', 'F2307 Type',
    'Affiliated Hospital', 'Crossed Check', 'Sent to legacy', 'old BOL Type', 'new BOL Type',
];

// Fixed system-constant values, copied from the real reference files —
// identical across DPS/UB there, so treated as shared defaults here too.
const COMMON_FIELDS = {
    status: 'Open',
    checkPrinted: 'No',
    paymentMethodCode: 'BOL',
    digitizedCheck: 'No',
    documentType: 'Payment',
    accountType: 'Vendor',
    createdBy: 'MEDICARDPHILS\\TESTUSER', // placeholder — real sample had an actual employee login
    description: 'Payment of Invoice PPI-0003696957',
    currencyCode: undefined,
    balAccountType: 'Bank Account',
    balAccountNo: 'UBX-P-6352',
    applied: 'Yes',
    appliesToDocType: 'Invoice',
    bankPaymentType: 'Computer Check',
    exportedToPaymentFile: 'No',
    totalExportedAmount: 0,
    hasPaymentExportError: 'No',
    processingType: 'CLAIMS-BOL-REG',
    printingRule2307: 'Per Payment/Check ',
    f2307Type: 'Short',
    affiliatedHospital: 'HPCN0820200003',
    crossedCheck: 'Yes',
    sentToLegacy: 'Yes',
    accountNo: '00000000', // placeholder — real sample's value looked bank-account-shaped
    messageToRecipient: 'Claims Payment', // placeholder — real sample's actual text wasn't readable/safe to copy
    amount: 270, // per explicit instruction
    appliesToDocNo: 'PPI-0003696957',
};

// The Document No.'s numeric suffix is a random 5-digit number, picked fresh
// each new day and incremented within that day — same reset-per-day shape
// as the intake generator's filename counter, except the starting point is
// randomized rather than a fixed value, so it doesn't look like a
// predictable test sequence. Deliberately still nowhere near the real
// sample's production-looking range (~0015xxx), to avoid any risk of
// colliding with a real future NAV/Business Central document number.
type SequenceState = {
    /** YYYYMMDD of the last run — a new day picks a fresh random base. */
    date: string;
    lastCounter: number;
    /** Disbursement File's check_no suffix — resets to 0 each new day, unlike lastCounter's random base. */
    checkNoCounter: number;
};

function todayYyyyMmDd(): string {
    const now = getToday();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}${month}${day}`;
}

function randomFiveDigitBase(): number {
    return Math.floor(Math.random() * 90_000) + 10_000; // 10000–99999
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

    return { date: today, lastCounter: randomFiveDigitBase(), checkNoCounter: 0 };
}

async function saveState(state: SequenceState): Promise<void> {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

// Posting Date / Applies-to Doc. Due Date — plain "MM/DD/YYYY" text, not a
// native Excel date (the real reference files stored these as datetimes,
// but the requested format here is the slash-separated string).
function formatMmDdYyyy(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}/${date.getFullYear()}`;
}

export type PassingRow = { controlCode: string; doctor: string; paymentMode: PaymentMode };

// Mirrors generate-claim-memos.ts's readFailedRows(), but for the opposite
// case: rows NOT tagged Action Memo = "Y" — i.e. claims that passed and are
// now eligible to actually be paid, which is what a Payment Journal entry
// represents. Scans every channel's own folder for today's date, same as
// readFailedRows().
export async function readPassingRows(): Promise<PassingRow[]> {
    const rows: PassingRow[] = [];

    for (const paymentMode of ALL_PAYMENT_MODES) {
        const channelDir = getChannelDir(paymentMode);

        let dirEntries: string[];
        try {
            dirEntries = await readdir(channelDir);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw err;
        }
        const files = dirEntries.filter(isIntakeFilename);

        for (const file of files) {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(path.join(channelDir, file));
            const sheet = workbook.worksheets[0];
            if (!sheet) continue;

            sheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return; // header

                const actionMemo = String(row.getCell(20).value ?? '').trim(); // "Action Memo"
                if (actionMemo === 'Y') return; // only passing rows

                const controlCode = String(row.getCell(14).value ?? '').trim(); // "Control Code"
                if (!controlCode) return;

                rows.push({
                    controlCode,
                    doctor: String(row.getCell(6).value ?? '').trim(), // "Doctor"
                    paymentMode,
                });
            });
        }
    }

    return rows;
}

function nextDocumentNo(paymentMode: JournalPaymentMode, state: SequenceState): string {
    state.lastCounter += 1;
    return `${DOCUMENT_NO_PREFIX[paymentMode]}${String(state.lastCounter).padStart(7, '0')}`;
}

// "CHK<YYYYMMDD>-<3-digit counter>T" — independent of nextDocumentNo's
// random base; this one starts at 001 each day, per explicit instruction.
function nextCheckNo(today: string, state: SequenceState): string {
    state.checkNoCounter += 1;
    return `CHK${today}-${String(state.checkNoCounter).padStart(3, '0')}T`;
}

async function buildJournalWorkbook(
    paymentMode: JournalPaymentMode,
    referenceControlNo: string,
    documentNo: string,
    todayFormatted: string
): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.columns = HEADERS.map((header) => ({ header }));

    sheet.addRow([
        COMMON_FIELDS.status,
        todayFormatted,
        null, // S No.
        null, // Check No.
        COMMON_FIELDS.checkPrinted,
        null, // Approver 1
        null, // Approver 2
        documentNo,
        COMMON_FIELDS.accountNo,
        referenceControlNo,
        COMMON_FIELDS.amount,
        COMMON_FIELDS.appliesToDocNo,
        todayFormatted,
        COMMON_FIELDS.paymentMethodCode,
        null, // Control Code (blank in the real samples too)
        COMMON_FIELDS.digitizedCheck,
        null, // Payment Reference
        COMMON_FIELDS.documentType,
        null, // External Document No.
        COMMON_FIELDS.accountType,
        COMMON_FIELDS.createdBy,
        null, // Recipient Bank Account
        COMMON_FIELDS.messageToRecipient,
        COMMON_FIELDS.description,
        COMMON_FIELDS.currencyCode,
        COMMON_FIELDS.balAccountType,
        COMMON_FIELDS.balAccountNo,
        COMMON_FIELDS.applied,
        COMMON_FIELDS.appliesToDocType,
        null, // Applies-to ID
        COMMON_FIELDS.bankPaymentType,
        COMMON_FIELDS.exportedToPaymentFile,
        COMMON_FIELDS.totalExportedAmount,
        COMMON_FIELDS.hasPaymentExportError,
        COMMON_FIELDS.processingType,
        COMMON_FIELDS.printingRule2307,
        COMMON_FIELDS.f2307Type,
        COMMON_FIELDS.affiliatedHospital,
        COMMON_FIELDS.crossedCheck,
        COMMON_FIELDS.sentToLegacy,
        ' ', // old BOL Type (single space in the real samples)
        NEW_BOL_TYPE[paymentMode], // new BOL Type — "E-CREDIT" for UB, not "UB"
    ]);

    return workbook;
}

async function findRowsForJournal(mode: JournalPaymentMode): Promise<PassingRow[]> {
    const [passing, failed] = await Promise.all([readPassingRows(), readFailedRows()]);
    const rows = [...passing, ...failed].filter((row) => row.paymentMode === mode);

    // A single OPEML file can carry more than one row for the same claim —
    // dedupe by Control Code so each one only produces one Payment Journal
    // entry, not "per raw spreadsheet row."
    const seen = new Set<string>();
    return rows.filter((row) => (seen.has(row.controlCode) ? false : (seen.add(row.controlCode), true)));
}

export async function generatePaymentJournals(): Promise<void> {
    const activeModes = filterPaymentModes(PAYMENT_MODES);
    if (activeModes.length === 0) {
        console.log(`PAYMENT_MODE_FILTER excludes both Payment Journal modes (${PAYMENT_MODES.join('/')}) — skipping.`);
        return;
    }

    // Not "rows.length === 0" for any one mode — check every active mode up
    // front and self-heal at most once, rather than once per mode (calling
    // generateIntakeBatches() per mode in a loop would generate a whole
    // extra day-batch for every mode that was missing, not just the first).
    const matchesByMode = new Map<JournalPaymentMode, PassingRow[]>();
    const loadMatches = async () => {
        for (const mode of activeModes) {
            matchesByMode.set(mode, await findRowsForJournal(mode));
        }
    };
    await loadMatches();
    if (activeModes.some((mode) => matchesByMode.get(mode)!.length === 0)) {
        await generateIntakeBatches();
        await loadMatches();
    }

    const state = await loadState();
    const today = getToday();
    const dateStamp = formatDateFolder(today);
    const todayFormatted = formatMmDdYyyy(today);

    for (const paymentMode of activeModes) {
        const matches = matchesByMode.get(paymentMode)!;
        if (matches.length === 0) {
            throw new Error(`No OPEML row found for ${paymentMode} — nothing to reference.`);
        }

        const outDir = getChannelDir(paymentMode, today);
        await mkdir(outDir, { recursive: true });

        for (const [i, match] of matches.entries()) {
            const documentNo = nextDocumentNo(paymentMode, state);
            const workbook = await buildJournalWorkbook(paymentMode, match.controlCode, documentNo, todayFormatted);

            // 2-digit sequence number in the middle of the filename (not a
            // trailing " (N)") for same-day duplicates, per explicit
            // instruction — same convention the Disbursement File uses.
            const seq = String(i + 1).padStart(2, '0');
            const outPath = path.join(outDir, `${paymentMode}_PAYMENT_JOURNAL_${seq}_${dateStamp}.xlsx`);
            await workbook.xlsx.writeFile(outPath);
            console.log(`Wrote ${paymentMode} Payment Journal: ${outPath}`);
        }
    }

    await saveState(state);
}

function buildDisbursementWorkbook(checkNo: string, checkDateFormatted: string, ctlno: string): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.columns = DISBURSEMENT_HEADERS.map((header) => ({ header }));

    sheet.addRow([
        checkNo,
        checkDateFormatted,
        DISBURSEMENT_D_CODE,
        ctlno,
        null, // found rec — blank in the real sample
        null, // bank — blank in the real sample
    ]);

    return workbook;
}

async function findComcheckRowsForDisbursement(): Promise<PassingRow[]> {
    const [passing, failed] = await Promise.all([readPassingRows(), readFailedRows()]);
    const comcheckRows = [...passing, ...failed].filter((row) => row.paymentMode === 'COMCHECK');

    // A single OPEML file can carry more than one row for the same claim —
    // dedupe by Control Code so each one only produces one Disbursement File.
    const seen = new Set<string>();
    return comcheckRows.filter((row) => (seen.has(row.controlCode) ? false : (seen.add(row.controlCode), true)));
}

// ComCheck's Disbursement File — not a Payment Journal (different template
// entirely, see the header comment). One file per ComCheck claim currently
// in its channel folder, covering both the passing and failing batch — not
// just the first passing match (a Disbursement File is a check record tied
// to a transaction, same reasoning as F2307's own multi-row fix).
export async function generateDisbursementFile(): Promise<void> {
    if (!matchesPaymentModeFilter('COMCHECK')) {
        console.log('PAYMENT_MODE_FILTER excludes ComCheck — skipping the Disbursement File.');
        return;
    }

    // Not "rows.length === 0" — other channels can have rows (a different
    // payment mode entirely) without having one for COMCHECK specifically.
    let matches = await findComcheckRowsForDisbursement();
    if (matches.length === 0) {
        await generateIntakeBatches();
        matches = await findComcheckRowsForDisbursement();
    }

    if (matches.length === 0) {
        throw new Error('No OPEML row found for COMCHECK — nothing to reference.');
    }

    const state = await loadState();
    const today = getToday();
    const todayCompact = todayYyyyMmDd();
    const dateStamp = formatDateFolder(today);
    const outDir = getChannelDir('COMCHECK', today);
    await mkdir(outDir, { recursive: true });

    for (const [i, match] of matches.entries()) {
        const checkNo = nextCheckNo(todayCompact, state);
        const workbook = buildDisbursementWorkbook(checkNo, formatMmDdYyyy(today), match.controlCode);

        // 2-digit sequence number in the middle of the filename (not a
        // trailing " (N)") for same-day duplicates, per explicit instruction.
        const seq = String(i + 1).padStart(2, '0');
        const outPath = path.join(outDir, `${dateStamp}-PF-IP-MS-EFT_${seq}_COMCHECK.xlsx`);
        await workbook.xlsx.writeFile(outPath);
        console.log(`Wrote ComCheck Disbursement File: ${outPath}`);
    }

    await saveState(state);
}

// Runs automatically only when invoked directly (`node scripts/generate-payment-journal.ts`),
// not when imported as a module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await generatePaymentJournals();
    await generateDisbursementFile();
}
