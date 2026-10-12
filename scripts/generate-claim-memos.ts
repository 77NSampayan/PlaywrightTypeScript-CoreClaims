// Generates the Action Memo (AM) and Disapproval Memo (DM) PDF pair MediCard
// issues per patient for every OPEML row tagged Action Memo = "Y" (i.e. the
// rows the claim upload is expected to reject).
//
// Built directly on top of the real reference documents — not a from-scratch
// plain-text reconstruction, which previously drifted from the real layout
// (missing the MediCard logo/watermark, DM's ISO certification badge, field
// positions, fonts, highlight box, etc.):
//   scripts/templates/ActionMemo_sample.pdf
//   scripts/templates/DisapprovalMemo_sample.pdf
// Every coordinate/font/size below was measured off those two PDFs with
// PyMuPDF (span "origin" = exact baseline point, page.get_images()/
// get_drawings() for the logo/watermark/badge image rects and the DM
// divider lines). The logo, watermark and ISO badge images themselves are
// extracted into scripts/templates/assets/ (combined with their PDF soft
// masks so the watermark/logo transparency survives) and re-embedded here —
// same "load the real artifact, overlay only what's dynamic" approach used
// for the F2307 template.
//
// Field-mapping (control number, member's name, visit date, reason — reason
// "can reflect NULL" in the template; here it's always the deliberate reason
// our own negative batch rows fail: a missing Diagnosis) is unchanged from
// before.
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
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(__dirname);
const INTAKE_DIR = path.join(REPO_ROOT, 'test-data', 'intake');
const MEMO_DIR = path.join(INTAKE_DIR, 'memos');
const ASSETS_DIR = path.join(__dirname, 'templates', 'assets');

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

// Visit Date is written as plain "MM/DD/YYYY" text by generate-intake-batches.ts,
// but a cell that's been opened/resaved in Excel can come back from ExcelJS as a
// native Date object instead — String(date) then produces a colon-laden form
// ("Fri Oct 09 2026 08:00:00 GMT+0800 ...") that isn't a valid filename fragment.
function cellToDateSlash(value: ExcelJS.CellValue): string {
    if (value instanceof Date) {
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${month}/${day}/${value.getFullYear()}`;
    }
    return String(value ?? '').trim();
}

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
                visitDateSlash: cellToDateSlash(row.getCell(8).value), // "Visit Date"
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

type DrawOpts = { bold?: boolean; italic?: boolean; size?: number };

// A draw() call's y is "distance from the top", matching PyMuPDF span
// origins directly — so every constant below can be copied straight out of
// the inspection script's output without a manual bottom-up conversion.
function makeDrawer(page: PDFPage, font: PDFFont, bold: PDFFont, italic: PDFFont) {
    return (text: string, x: number, yFromTop: number, opts: DrawOpts = {}): void => {
        page.drawText(text, {
            x,
            y: PAGE_HEIGHT - yFromTop,
            size: opts.size ?? 11,
            font: opts.italic ? italic : opts.bold ? bold : font,
            color: rgb(0, 0, 0),
        });
    };
}

function drawHLine(page: PDFPage, x0: number, x1: number, yFromTop: number): void {
    page.drawLine({
        start: { x: x0, y: PAGE_HEIGHT - yFromTop },
        end: { x: x1, y: PAGE_HEIGHT - yFromTop },
        thickness: 1,
        color: rgb(0, 0, 0),
    });
}

async function embedAsset(doc: PDFDocument, fileName: string) {
    const bytes = await readFile(path.join(ASSETS_DIR, fileName));
    return fileName.endsWith('.jpeg') || fileName.endsWith('.jpg') ? doc.embedJpg(bytes) : doc.embedPng(bytes);
}

// Coordinates/sizes measured directly off scripts/templates/ActionMemo_sample.pdf.
async function buildActionMemo(row: FailedRow, today: Date): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
    const draw = makeDrawer(page, font, bold, italic);

    const todayIso = formatIsoToday(today);

    const watermark = await embedAsset(doc, 'am_watermark.png');
    page.drawImage(watermark, { x: 326.24, y: PAGE_HEIGHT - 790.89, width: 286.47, height: 286.47 });

    const logo = await embedAsset(doc, 'am_logo.png');
    page.drawImage(logo, { x: 36, y: PAGE_HEIGHT - 75.66, width: 154.46, height: 44.99 });

    // Footer address block (the real template's only header content is the
    // logo above — this block sits at the bottom of the page, not the top).
    draw('MediCard Philippines, Inc.', 72.11, 708.58, { bold: true, size: 7 });
    draw('27F AIA Tower (formerly Philam Life Tower)', 72.11, 716.63, { size: 7 });
    draw('8767 Paseo De Roxas cor. Ayala Avenue, Makati City, Philippines 1226', 72.11, 724.68, { size: 7 });
    draw('(02) 8884-9999 / (02) 8841-8080', 72.11, 732.73, { size: 7 });
    draw('www.medicardphils.com', 72.11, 740.78, { size: 7 });

    draw('ACTION MEMO', 262.55, 110.89, { bold: true, size: 12 });

    // TO's yellow highlight box is sized to the sample's "JENNIFER EMPERADO"
    // (142.7pt) in the real file — widened here to fit whichever doctor name
    // is actually longer, so a long name isn't clipped by a fixed box.
    const toWidth = Math.max(italic.widthOfTextAtSize(row.doctor, 11) + 4, 142.7);
    page.drawRectangle({ x: 173.28, y: PAGE_HEIGHT - 154.26, width: toWidth, height: 12.73, color: rgb(1, 1, 0) });

    draw('TO', 72.11, 151.91, { bold: true });
    draw(':', 154.35, 151.91);
    draw(row.doctor, 173.40, 151.91, { italic: true });

    draw('FROM', 72.11, 184.39, { bold: true });
    draw(':', 154.35, 184.39);
    draw('CLAIMS DEPARTMENT', 173.40, 184.39);

    draw('SUBJECT', 72.11, 204.24, { bold: true });
    draw(':', 154.35, 204.24);
    draw(row.memberName, 173.40, 204.24);

    draw('DATE', 72.11, 224.11, { bold: true });
    draw(':', 154.35, 224.11);
    draw(todayIso, 173.40, 224.11);

    draw(`We hereby acknowledge the bill you submitted on ${todayIso} for processing.`, 72.11, 263.79);
    draw('However, we cannot process this bill at this time due to the following reason(s):', 72.11, 283.64);
    draw(REASON, 173.40, 303.93);

    draw('We kindly request submission of the correct and complete information so that we can proceed ', 72.11, 343.98);
    draw('with the processing of the claim.', 72.11, 359.80);

    draw('Please do not re-submit this bill until the required corrections or supporting documents have ', 72.11, 391.41);
    draw('been provided. Kindly respond within two (2) weeks upon receipt of this memo.', 72.11, 407.20);

    draw('Claims Processor', 145.59, 505.19);

    draw('Noted by:', 72.11, 544.90);
    draw('Mark Ruzzel Quezada', 132.46, 584.59, { bold: true });
    draw('Claims Lead', 158.15, 597.23);

    return doc.save();
}

// Coordinates/sizes measured directly off scripts/templates/DisapprovalMemo_sample.pdf.
async function buildDisapprovalMemo(row: FailedRow, today: Date): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
    const draw = makeDrawer(page, font, bold, italic);

    const todayLong = formatLongToday(today);

    const logo = await embedAsset(doc, 'dm_logo.png');
    page.drawImage(logo, { x: 42.75, y: PAGE_HEIGHT - 121.21, width: 82.46, height: 77.98 });

    const badge = await embedAsset(doc, 'dm_iso_badge.jpeg');
    page.drawImage(badge, { x: 438.01, y: PAGE_HEIGHT - 119.93, width: 137.96, height: 53.97 });

    draw('MediCard Philippines, Inc.', 132.01, 65.11, { bold: true, size: 9.1 });
    draw('Head Office: ', 132.01, 80.11, { bold: true, size: 6.6 });
    draw(' 8th Floor, The World Centre Building,', 174.84, 80.05, { size: 6.6 });
    draw('330 Sen. Gil Puyat Avenue, Makati City 1200', 132.01, 89.80, { size: 6.6 });
    draw('Trunkline: 884-9999; Fax No. 864-0630; 864-0891', 132.01, 99.55, { size: 6.6 });
    draw('Website: www.medicardphils.com', 132.01, 109.30, { size: 6.6 });

    draw('DISAPPROVAL MEMO', 279.30, 189.95, { bold: true, size: 9 });
    drawHLine(page, 52.19, 574.19, 197.23);
    drawHLine(page, 52.19, 574.19, 330.24);

    draw('MEMO TO', 72, 214.19, { size: 8.3 });
    draw(':', 126, 214.19, { size: 8.3 });
    draw(row.doctor, 141.73, 215.94, { italic: true, size: 11 });

    draw('HOSPITAL   :', 72, 232.19, { size: 8.3 });
    draw('SeriousMD Telemedicine CLAIMS', 144, 231.68, { size: 8.3 });

    draw('FROM', 72, 250.19, { size: 8.3 });
    draw(':', 126, 250.19, { size: 8.3 });
    draw('DEPARTMENT', 144, 249.48, { size: 8.3 });

    draw('SUBJECT', 72, 268.19, { size: 8.3 });
    draw(':', 126, 268.19, { size: 8.3 });
    draw(row.memberName, 144, 267.28, { size: 8.3 });

    draw('Inclusive Date of Availment:', 144, 285.62, { size: 8.3 });
    draw('From', 278.99, 286.19, { size: 8.3 });
    draw(row.visitDateSlash, 306.00, 286.24, { size: 8.3 });
    draw('To', 371.99, 286.19, { size: 8.3 });
    drawHLine(page, 396, 483.02, 288.74); // blank "To ___" line

    draw('DATE', 72, 304.19, { size: 8.3 });
    draw(':', 126, 304.19, { size: 8.3 });
    draw(todayLong, 144, 304.21, { size: 8.3 });

    draw('REF NO', 72, 322.19, { size: 8.3 });
    draw(':', 126, 322.19, { size: 8.3 });
    draw('TEST', 144, 321.68, { size: 8.3 });

    draw(`We hereby acknowledge the bills you have sent last ${row.visitDateSlash} with ${row.controlCode}.`, 72, 351.64, { size: 8.3 });
    draw('However, we regret to inform you that the said bills has been disapproved due to the following reason(s):', 72, 370.18, { size: 8.3 });
    draw(REASON, 78.01, 394.21, { bold: true, size: 8.3 });

    draw('In view of the above, we are returning all documents which you have sent to us.', 73.19, 466.19, { size: 8.3 });
    draw('For inquiries and clarification, please feel free to call us at 884-9999 local 9922 and 9919.', 74.69, 484.19, { size: 8.3 });

    draw('Sincerely,', 72, 532.18, { size: 8.3 });
    drawHLine(page, 77.98, 227.99, 562.73);
    draw('TEST', 123.39, 573.68, { size: 8.3 });
    draw('Claims Processor', 123.39, 585.64, { size: 8.3 });

    draw('Noted by:', 67.21, 616.17, { size: 8.3 });
    drawHLine(page, 77.98, 227.99, 642.25);
    draw('Cristina S. Cuevas, M.D.', 109.05, 658.18, { size: 8.3 });
    draw('Claims Manager - Claims & Reimbursement', 84.05, 676.15, { size: 8.3 });

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
