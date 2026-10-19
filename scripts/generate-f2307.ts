// Generates BIR Form 2307 ("Certificate of Creditable Tax Withheld at
// Source") for ComCheck only, per the field-mapping template ("F2307 (For
// Com Check only)").
//
// Unlike the earlier version of this script, this one does NOT rebuild the
// form from scratch as plain text — it loads the real template PDF
// (scripts/templates/F2307_template.pdf, copied verbatim from
// "F2307_sample form.pdf") and overlays only the doctor's name onto the
// blank "3 Payee's Name" field, keeping every other part of the real form
// (layout, barcode, boxes, Payor info, income table, signature) pixel-
// identical to the template. This was a direct correction after the
// from-scratch version didn't visually match the template ("bit its
// different to the template i sent").
//
// Generates one F2307 per ComCheck OPEML row currently in test-data/intake/
// — both the passing (Action Memo = "N") and failing ("Y") batch — not just
// the first passing match, since a F2307 is a payee tax cert tied to a given
// claim transaction, regardless of whether that claim itself passed
// validation. Payee's Name is each row's Doctor (per "you will get it in the
// intake file of ComCheck"), and the filename is built from that row's
// Control Code ("F2307_{ControlCode}", per the field-mapping template).
//
// Usage:
//     node scripts/generate-f2307.ts
//
// Output:
//     test-data/f2307/F2307_<ControlCode>.pdf (one per ComCheck row)

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { generateIntakeBatches, isDoctorForMode, matchesPaymentModeFilter } from './generate-intake-batches.ts';
import { readFailedRows } from './generate-claim-memos.ts';
import { readPassingRows } from './generate-payment-journal.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(__dirname);
const OUTPUT_DIR = path.join(REPO_ROOT, 'test-data', 'f2307');
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'F2307_template.pdf');

// Position of the blank "3 Payee's Name" field on the template, measured
// directly off its real coordinates (PyMuPDF word boxes): the field label
// sits at y≈155.7–164.2 (top-down), so the value is drawn just below it, on
// the same blank line the real form leaves for it — same left margin (x≈37)
// the template itself uses for every other field value (e.g. "SAN MIGUEL
// AVE..." under "4 Registered Address").
const PAYEE_NAME_X = 37;
const PAYEE_NAME_Y_FROM_TOP = 174;

async function buildF2307(payeeName: string): Promise<Uint8Array> {
    const templateBytes = await readFile(TEMPLATE_PATH);
    const doc = await PDFDocument.load(templateBytes);
    const page = doc.getPage(0);
    const font = await doc.embedFont(StandardFonts.Helvetica);

    page.drawText(payeeName, {
        x: PAYEE_NAME_X,
        y: page.getHeight() - PAYEE_NAME_Y_FROM_TOP,
        size: 9,
        font,
        color: rgb(0, 0, 0),
    });

    return doc.save();
}

async function findComcheckRows(): Promise<{ controlCode: string; doctor: string }[]> {
    const [passing, failed] = await Promise.all([readPassingRows(), readFailedRows()]);
    const comcheckRows = [...passing, ...failed].filter((row) => isDoctorForMode(row.doctor, 'COMCHECK'));

    // A single OPEML file can carry more than one row for the same claim
    // (e.g. generate-intake-batches.ts's 2-patient batches) — dedupe by
    // Control Code so each one only produces a single F2307.
    const seen = new Set<string>();
    return comcheckRows.filter((row) => (seen.has(row.controlCode) ? false : (seen.add(row.controlCode), true)));
}

export async function generateF2307(): Promise<void> {
    if (!matchesPaymentModeFilter('COMCHECK')) {
        console.log('PAYMENT_MODE_FILTER excludes ComCheck — skipping F2307 (ComCheck-only).');
        return;
    }

    await mkdir(OUTPUT_DIR, { recursive: true });

    let matches = await findComcheckRows();
    if (matches.length === 0) {
        // Not "rows.length === 0" — test-data/intake/ can have rows from
        // unrelated/stale files (a different doctor entirely) without
        // having one for the payment mode we actually need.
        await generateIntakeBatches();
        matches = await findComcheckRows();
    }

    if (matches.length === 0) {
        throw new Error('No OPEML row found for COMCHECK — nothing to reference.');
    }

    for (const match of matches) {
        // Use the matched row's actual doctor, not a fixed constant — keeps
        // this correct even if ComCheck's valid-doctor list changes again;
        // whichever one this specific row has is what should appear as the
        // Payee's Name.
        const bytes = await buildF2307(match.doctor);

        const outPath = path.join(OUTPUT_DIR, `F2307_${match.controlCode}.pdf`);
        await writeFile(outPath, bytes);
        console.log(`Wrote F2307: ${outPath}`);
    }
}

// Runs automatically only when invoked directly (`node scripts/generate-f2307.ts`),
// not when imported as a module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await generateF2307();
}
