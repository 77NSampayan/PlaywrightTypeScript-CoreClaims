import path from 'path';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import type { EligibleCode, StageUpdate } from '@utils/tracker/ControlCodeTracker.util.ts';
import { generatePaymentJournals, generateDisbursementFile } from '../scripts/generate-payment-journal.ts';

const ACTOR = 'PaymentJournalUpload.spec.ts';

// Both under "claimsblob" (not "testblob", like the other three upload
// specs) — confirmed via the real UB Payment Journal template's Reference
// Control No. pointing at one of our own synthetic OPEML control codes, same
// as every other upload target in this pipeline. Two different subfolders
// though: Payment Journal (DPS/UB) and Disbursement File (ComCheck) are
// different templates entirely, not just different payment modes of the
// same file.
const PAYMENT_JOURNAL_FOLDER = 'claimsblob/Data Enrichment/paymentjournal';
const DISBURSEMENT_FOLDER = 'claimsblob/Data Enrichment/comm_check';

// One file per control code, generated from that code's own test-data
// folder. Returns what to upload plus the tracker fields describing it.
async function generateFor(code: EligibleCode): Promise<{ filePath: string; folder: string; update: StageUpdate }> {
    const options = { controlCodes: [code.controlCode], date: code.folderDate };

    if (code.channel === 'COMCHECK') {
        const [disbursement] = await generateDisbursementFile(options);
        if (!disbursement) throw new Error(`No Disbursement File generated for ${code.controlCode} (is PAYMENT_MODE_FILTER excluding COMCHECK?).`);
        return {
            filePath: disbursement.filePath,
            folder: DISBURSEMENT_FOLDER,
            update: { fields: { paymentFileType: 'DISBURSEMENT', paymentFileName: path.basename(disbursement.filePath), documentNo: disbursement.checkNo } },
        };
    }

    const [journal] = await generatePaymentJournals(options);
    if (!journal) throw new Error(`No Payment Journal generated for ${code.controlCode} (is PAYMENT_MODE_FILTER excluding ${code.channel}?).`);
    return {
        filePath: journal.filePath,
        folder: PAYMENT_JOURNAL_FOLDER,
        update: { fields: { paymentFileType: 'PAYMENT_JOURNAL', paymentFileName: path.basename(journal.filePath), documentNo: journal.documentNo } },
    };
}

test.describe('Claims Intake — Payment Journal / Disbursement Upload', () => {
    // Writes to a real production Azure Blob Storage container — intentional,
    // same precedent as the other three upload specs, just a different
    // container (claimsblob, not testblob). Only runs under the `api`
    // project (see playwright.config.ts).
    //
    // Stage S5 of the Control Code Tracker: only codes confirmed visible in
    // Core Claims (S4 PASSED). DPS/UB get a Payment Journal, COMCHECK a
    // Disbursement File; passing opens S6's wait window at the upload time.
    test('Generates a fresh SAS via the Portal, then uploads the DPS/UB Payment Journal files and ComCheck Disbursement File through the API', async ({
        azureStorageSasPage,
        tracker,
        assert,
        logger,
    }) => {
        const eligible = await tracker.getEligible('S5_PAYMENT_UPLOAD');
        test.skip(eligible.length === 0, 'No control code is due for a Payment Journal / Disbursement upload (needs S4 PASSED in the tracker).');

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

        const accountSasUrl = new URL(blobServiceSasUrl);
        checkSasNotExpired(accountSasUrl);

        for (const code of eligible) {
            await logger.step(`UPLOAD_PAYMENT_FILE_${code.controlCode}`, async () => {
                await tracker.runStage(code.controlCode, 'S5_PAYMENT_UPLOAD', ACTOR, async () => {
                    const { filePath, folder, update } = await generateFor(code);
                    const result = await uploadFileToBlob(scopeToFolder(accountSasUrl, folder), filePath);
                    await assert.toEqual(result.status, 201, `upload response status for ${path.basename(filePath)}`);
                    return { ...update, detail: `${path.basename(filePath)} → ${folder}` };
                });
            });
        }
    });
});
