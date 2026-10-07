// Generates the Action Memo (AM) and Disapproval Memo (DM) PDF pair MediCard
// issues per patient for every OPEML row tagged Action Memo = "Y" (i.e. the
// rows the claim upload is expected to reject). Content/layout and the file
// naming convention are copied from the real reference documents:
//   OPEML2026092900428T_ROMEO DINGLASAN_09282026_AM.pdf
//   OPEML2026092900428T_ROMEO DINGLASAN_09282026_DM.pdf
// and the "Action Memo / Disapproved Memo" field-mapping template (control
// number, member's name, visit date, reason — reason "can reflect NULL" in
// the template; here it's always the deliberate reason our own negative
// batch rows fail: a missing Diagnosis).
//
// Reads every .xlsx already produced by generate-intake-batches.ts under
// test-data/intake/ rather than re-deriving which rows were "just" generated
// — so it stays correct even if run later, against whichever OPEML files
// are sitting in that folder at the time.
//
// Usage:
//     node scripts/generate-claim-memos.ts
//
// Output:
//     test-data/intake/memos/<Control Code>_<Member Name>_<visit date MMDDYYYY>_AM.pdf
//     test-data/intake/memos/<Control Code>_<Member Name>_<visit date MMDDYYYY>_DM.pdf

import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { mkdir, readdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(__dirname);
const INTAKE_DIR = path.join(REPO_ROOT, 'test-data', 'intake');
const MEMO_DIR = path.join(INTAKE_DIR, 'memos');

// The reason is always this for our own negative-batch data: every "Y"-tagged
// row is deliberately generated with blank Diagnosis/Dx Code. In the real
// system this text is pulled from the DB exception the upload raised, not
// invented here.
const REASON = 'Diagnosis is missing in file';

export type FailedRow = {
    controlCode: string;
    memberName: string;
    doctor: string;
    /** As stored in the sheet, e.g. "10/04/2026". */
    visitDateSlash: string;
};

export async function readFailedRows(): Promise<FailedRow[]> {
    const rows: FailedRow[] = [];

    let dirEntries: string[];
    try {
        dirEntries = await readdir(INTAKE_DIR);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return rows; // nothing generated yet
        throw err;
    }
    const files = dirEntries.filter((f) => f.toLowerCase().endsWith('.xlsx'));

    for (const file of files) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(path.join(INTAKE_DIR, file));
        const sheet = workbook.worksheets[0];
        if (!sheet) continue;

        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // header

            const actionMemo = String(row.getCell(20).value ?? '').trim(); // "Action Memo"
            if (actionMemo !== 'Y') return;

            rows.push({
                memberName: String(row.getCell(2).value ?? '').trim(),   // "Name"
                doctor: String(row.getCell(6).value ?? '').trim(),       // "Doctor"
                visitDateSlash: String(row.getCell(8).value ?? '').trim(), // "Visit Date"
                controlCode: String(row.getCell(14).value ?? '').trim(), // "Control Code"
            });
        });
    }

    return rows;
}

function slashToCompact(dateSlash: string): string {
    // "10/04/2026" -> "10042026" — matches the template's file-naming example
    // (…_10052026_AM.pdf).
    return dateSlash.replace(/\//g, '');
}

function slashToIso(dateSlash: string): string {
    // "10/04/2026" -> "2026-10-04"
    const [month, day, year] = dateSlash.split('/');
    return `${year}-${month}-${day}`;
}

function formatIsoToday(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

function formatLongToday(date: Date): string {
    return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT_MARGIN = 72;
const LINE_HEIGHT = 16;

type Writer = {
    page: PDFPage;
    font: PDFFont;
    bold: PDFFont;
    y: number;
};

function line(w: Writer, text: string, opts: { bold?: boolean; size?: number; indent?: number } = {}): void {
    const size = opts.size ?? 10;
    w.page.drawText(text, {
        x: LEFT_MARGIN + (opts.indent ?? 0),
        y: w.y,
        size,
        font: opts.bold ? w.bold : w.font,
        color: rgb(0, 0, 0),
    });
    w.y -= LINE_HEIGHT;
}

function centered(w: Writer, text: string, opts: { bold?: boolean; size?: number } = {}): void {
    const size = opts.size ?? 13;
    const font = opts.bold ? w.bold : w.font;
    const textWidth = font.widthOfTextAtSize(text, size);
    w.page.drawText(text, {
        x: (PAGE_WIDTH - textWidth) / 2,
        y: w.y,
        size,
        font,
        color: rgb(0, 0, 0),
    });
    w.y -= LINE_HEIGHT * 1.5;
}

function blank(w: Writer, count = 1): void {
    w.y -= LINE_HEIGHT * count;
}

async function buildActionMemo(row: FailedRow, today: Date): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const w: Writer = { page, font, bold, y: PAGE_HEIGHT - 60 };

    const todayIso = formatIsoToday(today);

    line(w, 'MediCard Philippines, Inc.', { bold: true, size: 12 });
    line(w, '27F AIA Tower (formerly Philam Life Tower)', { size: 9 });
    line(w, '8767 Paseo De Roxas cor. Ayala Avenue, Makati City, Philippines 1226', { size: 9 });
    line(w, '(02) 8884-9999 / (02) 8841-8080', { size: 9 });
    line(w, 'www.medicardphils.com', { size: 9 });
    blank(w, 1.5);

    centered(w, 'ACTION MEMO', { bold: true, size: 14 });
    blank(w, 0.5);

    line(w, `TO      : ${row.doctor}`);
    line(w, 'FROM    : CLAIMS DEPARTMENT');
    line(w, `SUBJECT : ${row.memberName}`);
    line(w, `DATE    : ${slashToIso(row.visitDateSlash)}`);
    blank(w);

    line(w, `We hereby acknowledge the bill you submitted on ${todayIso} for processing.`);
    line(w, 'However, we cannot process this bill at this time due to the following reason(s):');
    blank(w);
    line(w, REASON, { indent: 18 });
    blank(w);

    line(w, 'We kindly request submission of the correct and complete information so that we can proceed');
    line(w, 'with the processing of the claim.');
    blank(w);
    line(w, 'Please do not re-submit this bill until the required corrections or supporting documents have');
    line(w, 'been provided. Kindly respond within two (2) weeks upon receipt of this memo.');
    blank(w, 4);

    line(w, 'Claims Processor', { indent: 180 });
    blank(w, 2);
    line(w, 'Noted by:');
    blank(w);
    line(w, 'Mark Ruzzel Quezada', { bold: true });
    line(w, 'Claims Lead');

    return doc.save();
}

async function buildDisapprovalMemo(row: FailedRow, today: Date): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const w: Writer = { page, font, bold, y: PAGE_HEIGHT - 60 };

    const todayLong = formatLongToday(today);

    line(w, 'MediCard Philippines, Inc.', { bold: true, size: 12 });
    line(w, 'Head Office: 8th Floor, The World Centre Building,', { size: 9 });
    line(w, '330 Sen. Gil Puyat Avenue, Makati City 1200', { size: 9 });
    line(w, 'Trunkline: 884-9999; Fax No. 864-0630; 864-0891', { size: 9 });
    line(w, 'Website: www.medicardphils.com', { size: 9 });
    blank(w, 1.5);

    centered(w, 'DISAPPROVAL MEMO', { bold: true, size: 14 });
    blank(w, 0.5);

    line(w, `MEMO TO : ${row.doctor}`);
    line(w, 'HOSPITAL : SeriousMD Telemedicine CLAIMS');
    line(w, 'FROM : DEPARTMENT');
    line(w, `SUBJECT : ${row.memberName}`);
    line(w, `Inclusive Date of Availment: From ${row.visitDateSlash} To ___________`);
    line(w, `DATE : ${todayLong}`);
    line(w, 'REF NO : TEST');
    blank(w);

    line(w, `We hereby acknowledge the bills you have sent last ${row.visitDateSlash} with ${row.controlCode}.`);
    line(w, 'However, we regret to inform you that the said bills has been disapproved due to the following reason(s):');
    blank(w);
    line(w, REASON, { indent: 18 });
    blank(w, 2);

    line(w, 'In view of the above, we are returning all documents which you have sent to us.');
    line(w, 'For inquiries and clarification, please feel free to call us at 884-9999 local 9922 and 9919.');
    blank(w, 2);

    line(w, 'Sincerely,');
    blank(w, 3);
    line(w, 'TEST', { indent: 180 });
    line(w, 'Claims Processor', { indent: 180 });
    blank(w, 2);
    line(w, 'Noted by:');
    blank(w, 3);
    line(w, 'Cristina S. Cuevas, M.D.', { bold: true });
    line(w, 'Claims Manager - Claims & Reimbursement');

    return doc.save();
}

// Exported so tests/ActionMemoUpload.spec.ts can call it directly (generate
// memos on demand when test-data/intake/memos/ is empty) instead of
// requiring a separate manual `node scripts/generate-claim-memos.ts` step.
export async function generateClaimMemos(): Promise<void> {
    await mkdir(MEMO_DIR, { recursive: true });

    const failedRows = await readFailedRows();
    if (failedRows.length === 0) {
        console.log('No Action Memo = "Y" rows found under test-data/intake/ — run generate-intake-batches.ts first.');
        return;
    }

    const today = new Date();

    for (const row of failedRows) {
        const visitDateCompact = slashToCompact(row.visitDateSlash);
        const baseName = `${row.controlCode}_${row.memberName}_${visitDateCompact}`;

        const amBytes = await buildActionMemo(row, today);
        const amPath = path.join(MEMO_DIR, `${baseName}_AM.pdf`);
        await writeFile(amPath, amBytes);
        console.log(`Wrote Action Memo: ${amPath}`);

        const dmBytes = await buildDisapprovalMemo(row, today);
        const dmPath = path.join(MEMO_DIR, `${baseName}_DM.pdf`);
        await writeFile(dmPath, dmBytes);
        console.log(`Wrote Disapproval Memo: ${dmPath}`);
    }
}

// Runs automatically only when invoked directly (`node scripts/generate-claim-memos.ts`),
// not when imported as a module (e.g. by tests/ActionMemoUpload.spec.ts).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await generateClaimMemos();
}
