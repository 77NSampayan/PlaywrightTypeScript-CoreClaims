import { readdir } from 'fs/promises';
import { test } from '@fixtures/base.fixture.ts';
import { test_credentials } from '@root/playwright.config.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import { generateIntakeBatches, PAYMENT_MODE_DOCTORS, type PaymentMode } from '../scripts/generate-intake-batches.ts';
import { generateClaimMemos, readFailedRows } from '../scripts/generate-claim-memos.ts';

const MEMO_DIR = 'test-data/intake/memos';
// Folder is "Disapproved_Memo" (past tense) — matches the real captured
// request exactly, not "corrected" to match the document title ("Disapproval
// Memo") or the Action Memo folder's naming style.
const DISAPPROVED_MEMO_FOLDER = 'testblob/Disapproved_Memo/OP_Teleconsultation';

const PAYMENT_MODES: PaymentMode[] = ['DPS', 'COMCHECK', 'UB'];

// ComCheck's memo uploads go into an extra nested subfolder; DPS and UB
// upload directly into DISAPPROVED_MEMO_FOLDER. Confirmed from the real
// Portal breadcrumbs (testblob/Disapproved_Memo/OP_Teleconsultation/COM_CHECK
// for ComCheck specifically — DPS and UB have no such subfolder).
const PAYMENT_MODE_SUBFOLDER: Partial<Record<PaymentMode, string>> = {
    COMCHECK: 'COM_CHECK',
};

function resolveFolder(baseFolder: string, paymentMode: PaymentMode): string {
    const subfolder = PAYMENT_MODE_SUBFOLDER[paymentMode];
    return subfolder ? `${baseFolder}/${subfolder}` : baseFolder;
}

// Finds this run's Disapproval Memo PDFs for one payment mode — same
// cross-referencing approach as ActionMemoUpload.spec.ts's
// findActionMemosForPaymentMode(), just matching "_dm.pdf" instead of
// "_am.pdf".
async function findDisapprovalMemosForPaymentMode(paymentMode: PaymentMode): Promise<string[]> {
    let failedRows = await readFailedRows();
    if (failedRows.length === 0) {
        await generateIntakeBatches();
        failedRows = await readFailedRows();
    }

    const targetDoctor = PAYMENT_MODE_DOCTORS[paymentMode];
    const controlCodes = new Set(
        failedRows.filter((row) => row.doctor === targetDoctor.trim()).map((row) => row.controlCode)
    );
    if (controlCodes.size === 0) {
        throw new Error(`No OPEML rows found for ${paymentMode} (doctor "${targetDoctor}") — nothing to upload.`);
    }

    let memoFiles = await readdir(MEMO_DIR).catch(() => [] as string[]);
    if (memoFiles.length === 0) {
        await generateClaimMemos();
        memoFiles = await readdir(MEMO_DIR);
    }

    const matches = memoFiles.filter(
        (f) => f.toLowerCase().endsWith('_dm.pdf') && [...controlCodes].some((code) => f.startsWith(code))
    );
    if (matches.length === 0) {
        throw new Error(`No Disapproval Memo PDFs found for ${paymentMode} under ${MEMO_DIR}/ even after generating.`);
    }
    return matches.map((f) => `${MEMO_DIR}/${f}`);
}

test.describe('Claims Intake — Disapproved Memo Upload', () => {
    // Writes to a real production Azure Blob Storage container — intentional,
    // same precedent as IntakeUpload.spec.ts / ActionMemoUpload.spec.ts. Only
    // runs under the `api` project (see playwright.config.ts).
    //
    // One login/SAS generation covers all three payment modes — only the
    // upload target folder changes per mode (ComCheck nests one level
    // deeper), not the credential.
    test('Generates a fresh SAS via the Portal, then uploads every payment mode\'s Disapproval Memo PDFs through the API', async ({
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

        for (const paymentMode of PAYMENT_MODES) {
            await logger.step(`UPLOAD_DISAPPROVAL_MEMOS_${paymentMode}`, async () => {
                const folder = resolveFolder(DISAPPROVED_MEMO_FOLDER, paymentMode);
                const sasUrl = scopeToFolder(new URL(blobServiceSasUrl), folder);
                checkSasNotExpired(sasUrl);

                const filePaths = await findDisapprovalMemosForPaymentMode(paymentMode);
                for (const filePath of filePaths) {
                    const result = await uploadFileToBlob(sasUrl, filePath);
                    await assert.toEqual(result.status, 201, `upload response status for ${filePath}`);
                }
            });
        }
    });
});
