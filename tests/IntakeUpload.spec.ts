import { readdir } from 'fs/promises';
import { test } from '@fixtures/base.fixture.ts';
import { test_credentials } from '@root/playwright.config.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import { generateIntakeBatches } from '../scripts/generate-intake-batches.ts';

const INTAKE_DIR = 'test-data/intake';
const INTAKE_FOLDER = 'testblob/Out-Patient Teleconsulation';

async function listXlsxFiles(): Promise<string[]> {
    try {
        const files = await readdir(INTAKE_DIR);
        return files.filter((f) => f.toLowerCase().endsWith('.xlsx'));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
    }
}

// Picks up whatever is currently on disk rather than hardcoding filenames —
// scripts/generate-intake-batches.ts's own naming (date + daily counter)
// means hardcoded names wouldn't reliably exist by the time this runs.
// Generates a fresh batch on demand if the folder is empty, rather than
// requiring a separate manual script run first.
async function listIntakeFiles(): Promise<string[]> {
    let files = await listXlsxFiles();
    if (files.length === 0) {
        await generateIntakeBatches();
        files = await listXlsxFiles();
    }

    if (files.length === 0) {
        throw new Error(`No .xlsx files found under ${INTAKE_DIR}/ even after running the generator.`);
    }
    return files.map((f) => `${INTAKE_DIR}/${f}`);
}

test.describe('Claims Intake — Azure Blob Upload', () => {
    // This test writes to a real production Azure Blob Storage container —
    // intentional (confirmed with the test data owner), not a mistake. It
    // only runs under the `api` project (see playwright.config.ts), so a
    // bare `npx playwright test` still exercises it like every other
    // project — same precedent as Database.spec.ts's live DB writes.
    //
    // Logs into the Azure Portal (reusing the same Microsoft SSO flow/
    // credentials as the Core Claims app), generates a fresh account-level
    // SAS via the "Shared access signature" blade, then uploads every file
    // currently in test-data/intake/ through the same fast API call
    // scripts/upload-intake-files.ts uses — rather than driving the Portal's
    // own (slower, heavier) Upload button. One SAS, minted fresh this run,
    // covers the whole batch — no per-file expiry concern within one run.
    test('Generates a fresh SAS via the Portal, then uploads every intake file through the API', async ({
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

        await logger.step('UPLOAD_INTAKE_FILES', async () => {
            const sasUrl = scopeToFolder(new URL(blobServiceSasUrl), INTAKE_FOLDER);
            checkSasNotExpired(sasUrl);

            const filePaths = await listIntakeFiles();
            for (const filePath of filePaths) {
                const result = await uploadFileToBlob(sasUrl, filePath);
                await assert.toEqual(result.status, 201, `upload response status for ${filePath}`);
            }
        });
    });
});
