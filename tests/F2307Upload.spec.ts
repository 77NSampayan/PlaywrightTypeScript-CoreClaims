import { readdir } from 'fs/promises';
import { test } from '@fixtures/base.fixture.ts';
import { test_credentials } from '@root/playwright.config.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import { generateF2307 } from '../scripts/generate-f2307.ts';

const F2307_DIR = 'test-data/f2307';
// Back under "testblob" (not "claimsblob", like Payment Journal/Disbursement)
// — same container as the original OPEML/memo uploads, new top-level folder.
const F2307_FOLDER = 'testblob/F2307 Output/COM_CHECK';

async function listF2307Files(): Promise<string[]> {
    let files: string[];
    try {
        files = await readdir(F2307_DIR);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') files = [];
        else throw err;
    }

    files = files.filter((f) => f.toLowerCase().endsWith('.pdf'));
    if (files.length === 0) {
        await generateF2307();
        files = (await readdir(F2307_DIR)).filter((f) => f.toLowerCase().endsWith('.pdf'));
    }

    if (files.length === 0) {
        throw new Error(`No F2307 files found under ${F2307_DIR}/ even after generating.`);
    }
    return files.map((f) => `${F2307_DIR}/${f}`);
}

test.describe('Claims Intake — F2307 Upload (ComCheck)', () => {
    // Writes to a real production Azure Blob Storage container — intentional,
    // same precedent as the other upload specs. Only runs under the `api`
    // project (see playwright.config.ts).
    test('Generates a fresh SAS via the Portal, then uploads the ComCheck F2307 file through the API', async ({
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

        await logger.step('UPLOAD_F2307_FILES', async () => {
            const sasUrl = scopeToFolder(new URL(blobServiceSasUrl), F2307_FOLDER);
            checkSasNotExpired(sasUrl);

            const filePaths = await listF2307Files();
            for (const filePath of filePaths) {
                const result = await uploadFileToBlob(sasUrl, filePath);
                await assert.toEqual(result.status, 201, `upload response status for ${filePath}`);
            }
        });
    });
});
