import { readdir } from 'fs/promises';
import { test } from '@fixtures/base.fixture.ts';
import { test_credentials } from '@root/playwright.config.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import { generatePaymentJournals, generateDisbursementFile } from '../scripts/generate-payment-journal.ts';

const JOURNAL_DIR = 'test-data/payment-journal';
const DISBURSEMENT_DIR = 'test-data/disbursement';

// Both under "claimsblob" (not "testblob", like the other three upload
// specs) — confirmed via the real UB Payment Journal template's Reference
// Control No. pointing at one of our own synthetic OPEML control codes, same
// as every other upload target in this pipeline. Two different subfolders
// though: Payment Journal (DPS/UB) and Disbursement File (ComCheck) are
// different templates entirely, not just different payment modes of the
// same file.
const PAYMENT_JOURNAL_FOLDER = 'claimsblob/Data Enrichment/paymentjournal';
const DISBURSEMENT_FOLDER = 'claimsblob/Data Enrichment/comm_check';

async function listXlsxFiles(dir: string): Promise<string[]> {
    try {
        const files = await readdir(dir);
        return files.filter((f) => f.toLowerCase().endsWith('.xlsx'));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
    }
}

async function listJournalFiles(): Promise<string[]> {
    let files = await listXlsxFiles(JOURNAL_DIR);
    if (files.length === 0) {
        await generatePaymentJournals();
        files = await listXlsxFiles(JOURNAL_DIR);
    }
    if (files.length === 0) {
        throw new Error(`No Payment Journal files found under ${JOURNAL_DIR}/ even after generating.`);
    }
    return files.map((f) => `${JOURNAL_DIR}/${f}`);
}

async function listDisbursementFiles(): Promise<string[]> {
    let files = await listXlsxFiles(DISBURSEMENT_DIR);
    if (files.length === 0) {
        await generateDisbursementFile();
        files = await listXlsxFiles(DISBURSEMENT_DIR);
    }
    if (files.length === 0) {
        throw new Error(`No Disbursement File found under ${DISBURSEMENT_DIR}/ even after generating.`);
    }
    return files.map((f) => `${DISBURSEMENT_DIR}/${f}`);
}

test.describe('Claims Intake — Payment Journal / Disbursement Upload', () => {
    // Writes to a real production Azure Blob Storage container — intentional,
    // same precedent as the other three upload specs, just a different
    // container (claimsblob, not testblob). Only runs under the `api`
    // project (see playwright.config.ts).
    test('Generates a fresh SAS via the Portal, then uploads the DPS/UB Payment Journal files and ComCheck Disbursement File through the API', async ({
        microsoftLoginPage,
        azureStorageSasPage,
        assert,
        logger,
    }) => {
        await logger.step('LOGIN_TO_AZURE_PORTAL', async () => {
            await azureStorageSasPage.navigate(uiEndPoints.azureStorageSas);
            await microsoftLoginPage.login(
                test_credentials.valid_username_1,
                test_credentials.valid_password_1,
                test_credentials.valid_otp_secret_1
            );
            await microsoftLoginPage.expectRedirectedBackToApp();
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
