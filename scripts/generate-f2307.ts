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
// Generates one F2307 per ComCheck OPEML row currently in ComCheck's channel
// folder — both the passing (Action Memo = "N") and failing ("Y") batch —
// not just the first passing match, since a F2307 is a payee tax cert tied
// to a given claim transaction, regardless of whether that claim itself
// passed validation. Payee's Name is each row's Doctor (per "you will get it
// in the intake file of ComCheck"), and the filename is built from that
// row's Control Code ("F2307_{ControlCode}", per the field-mapping template).
//
// Usage:
//     node scripts/generate-f2307.ts
//
// Output (written into ComCheck's channel/date folder, alongside the intake
// file it came from, not a separate shared folder):
//     test-data/COM CHECK/<date>/F2307_<ControlCode>.pdf (one per ComCheck row)

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { generateIntakeBatches, getChannelDir, matchesPaymentModeFilter } from './generate-intake-batches.ts';
import { readFailedRows } from './generate-claim-memos.ts';
import { readPassingRows, type GenerateForCodesOptions } from './generate-payment-journal.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

async function findComcheckRows(date?: Date): Promise<{ controlCode: string; doctor: string }[]> {
    const [passing, failed] = await Promise.all([readPassingRows(date), readFailedRows(date)]);
    const comcheckRows = [...passing, ...failed].filter((row) => row.paymentMode === 'COMCHECK');

    // A single OPEML file can carry more than one row for the same claim
    // (e.g. generate-intake-batches.ts's 2-patient batches) — dedupe by
    // Control Code so each one only produces a single F2307.
    const seen = new Set<string>();
    return comcheckRows.filter((row) => (seen.has(row.controlCode) ? false : (seen.add(row.controlCode), true)));
}

export type GeneratedF2307 = { controlCode: string; filePath: string };

// `controlCodes` + `date` (both optional; the CLI passes neither) narrow it
// to the codes the Control Code Tracker says are due, read from their own
// channel/date folder, with no self-healing — same contract as
// generatePaymentJournals()'s GenerateForCodesOptions.
export async function generateF2307(options: GenerateForCodesOptions = {}): Promise<GeneratedF2307[]> {
    if (!matchesPaymentModeFilter('COMCHECK')) {
        console.log('PAYMENT_MODE_FILTER excludes ComCheck — skipping F2307 (ComCheck-only).');
        return [];
    }

    let matches = await findComcheckRows(options.date);
    if (options.controlCodes) {
        const wanted = new Set(options.controlCodes);
        matches = matches.filter((row) => wanted.has(row.controlCode));
        const missing = options.controlCodes.filter((code) => !matches.some((row) => row.controlCode === code));
        if (missing.length > 0) {
            throw new Error(`No COMCHECK intake row found for ${missing.join(', ')} — nothing to reference.`);
        }
    } else if (matches.length === 0) {
        // Not "rows.length === 0" — other channels can have rows (a
        // different payment mode entirely) without having one for the
        // payment mode we actually need.
        await generateIntakeBatches();
        matches = await findComcheckRows();
    }

    if (matches.length === 0) {
        throw new Error('No OPEML row found for COMCHECK — nothing to reference.');
    }

    const outDir = getChannelDir('COMCHECK', options.date);
    await mkdir(outDir, { recursive: true });
    const written: GeneratedF2307[] = [];

    for (const match of matches) {
        // Use the matched row's actual doctor, not a fixed constant — keeps
        // this correct even if ComCheck's valid-doctor list changes again;
        // whichever one this specific row has is what should appear as the
        // Payee's Name.
        const bytes = await buildF2307(match.doctor);

        const outPath = path.join(outDir, `F2307_${match.controlCode}.pdf`);
        await writeFile(outPath, bytes);
        console.log(`Wrote F2307: ${outPath}`);
        written.push({ controlCode: match.controlCode, filePath: outPath });
    }
    return written;
}

// Runs automatically only when invoked directly (`node scripts/generate-f2307.ts`),
// not when imported as a module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await generateF2307();
}
