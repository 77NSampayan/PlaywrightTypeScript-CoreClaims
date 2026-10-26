import { readdir } from 'fs/promises';
import path from 'path';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import { getChannelDir } from '../scripts/generate-intake-batches.ts';
import { generatePaymentJournals, generateDisbursementFile } from '../scripts/generate-payment-journal.ts';

// Both under "claimsblob" (not "testblob", like the other three upload
// specs) — confirmed via the real UB Payment Journal template's Reference
// Control No. pointing at one of our own synthetic OPEML control codes, same
// as every other upload target in this pipeline. Two different subfolders
// though: Payment Journal (DPS/UB) and Disbursement File (ComCheck) are
// different templates entirely, not just different payment modes of the
// same file.
const PAYMENT_JOURNAL_FOLDER = 'claimsblob/Data Enrichment/paymentjournal';
const DISBURSEMENT_FOLDER = 'claimsblob/Data Enrichment/comm_check';

// Payment Journal/Disbursement now live in their channel's shared
// test-data/<CHANNEL>/<date>/ folder, alongside that channel's intake file
// (and memos) — these patterns pick out just the Payment Journal/Disbursement
// output, not the other .xlsx artifacts sitting next to it.
const isJournalFilename = (f: string) => /^(DPS|UB)_PAYMENT_JOURNAL_/.test(f) && f.toLowerCase().endsWith('.xlsx');
const isDisbursementFilename = (f: string) => /-PF-IP-MS-EFT_/.test(f) && f.toLowerCase().endsWith('.xlsx');

async function listMatchingFiles(dir: string, matches: (f: string) => boolean): Promise<string[]> {
    try {
        const files = await readdir(dir);
        return files.filter(matches).map((f) => path.join(dir, f));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
    }
}

async function listJournalFiles(): Promise<string[]> {
    const dirs = [getChannelDir('DPS'), getChannelDir('UB')];

    let files = (await Promise.all(dirs.map((dir) => listMatchingFiles(dir, isJournalFilename)))).flat();
    if (files.length === 0) {
        await generatePaymentJournals();
        files = (await Promise.all(dirs.map((dir) => listMatchingFiles(dir, isJournalFilename)))).flat();
    }
    if (files.length === 0) {
        throw new Error('No Payment Journal files found even after generating.');
    }
    return files;
}

async function listDisbursementFiles(): Promise<string[]> {
    const dir = getChannelDir('COMCHECK');

    let files = await listMatchingFiles(dir, isDisbursementFilename);
    if (files.length === 0) {
        await generateDisbursementFile();
        files = await listMatchingFiles(dir, isDisbursementFilename);
    }
    if (files.length === 0) {
        throw new Error(`No Disbursement File found under ${dir}/ even after generating.`);
    }
    return files;
}

test.describe('Claims Intake — Payment Journal / Disbursement Upload', () => {
    // Writes to a real production Azure Blob Storage container — intentional,
    // same precedent as the other three upload specs, just a different
    // container (claimsblob, not testblob). Only runs under the `api`
    // project (see playwright.config.ts).
    test('Generates a fresh SAS via the Portal, then uploads the DPS/UB Payment Journal files and ComCheck Disbursement File through the API', async ({
        azureStorageSasPage,
        assert,
        logger,
    }) => {
        // Already signed in: the `setup` project (tests/auth.setup.ts) saved the
        // Microsoft session this test starts from, so no password or OTP here.
        await logger.step('OPEN_AZURE_PORTAL_WITH_SAVED_SESSION', async () => {
            await azureStorageSasPage.navigate(uiEndPoints.azureStorageSas);
            await azureStorageSasPage.expectSasBladeVisible();
        });

        let blobServiceSasUrl = '';

        await logger.step('GENERATE_FRESH_SAS', async () => {
            await azureStorageSasPage.enableAllResourceTypes();
            await azureStorageSasPage.clickGenerate();
            blobServiceSasUrl = await azureStorageSasPage.getBlobServiceSasUrl();
        });

        await logger.step('UPLOAD_PAYMENT_JOURNALS', async () => {
            const sasUrl = scopeToFolder(new URL(blobServiceSasUrl), PAYMENT_JOURNAL_FOLDER);
            checkSasNotExpired(sasUrl);

            const filePaths = await listJournalFiles();
            for (const filePath of filePaths) {
                const result = await uploadFileToBlob(sasUrl, filePath);
                await assert.toEqual(result.status, 201, `upload response status for ${filePath}`);
            }
        });

        await logger.step('UPLOAD_DISBURSEMENT_FILE', async () => {
            const sasUrl = scopeToFolder(new URL(blobServiceSasUrl), DISBURSEMENT_FOLDER);
            checkSasNotExpired(sasUrl);

            const filePaths = await listDisbursementFiles();
            for (const filePath of filePaths) {
                const result = await uploadFileToBlob(sasUrl, filePath);
                await assert.toEqual(result.status, 201, `upload response status for ${filePath}`);
            }
        });
    });
});
