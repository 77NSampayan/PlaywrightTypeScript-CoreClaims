import { readdir } from 'fs/promises';
import { test } from '@fixtures/base.fixture.ts';
import { test_credentials } from '@root/playwright.config.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import { generateReturnFile } from '../scripts/generate-return-file.ts';

const RETURN_FILE_DIR = 'test-data/return-file';
const RETURN_FILE_FOLDER = 'testblob/ReturnFile_OPTeleconsult/DPS';

async function listReturnFiles(): Promise<string[]> {
    let files: string[];
    try {
        files = await readdir(RETURN_FILE_DIR);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') files = [];
        else throw err;
    }

    files = files.filter((f) => f.toLowerCase().endsWith('.csv'));
    if (files.length === 0) {
        await generateReturnFile();
        files = (await readdir(RETURN_FILE_DIR)).filter((f) => f.toLowerCase().endsWith('.csv'));
    }

    if (files.length === 0) {
        throw new Error(`No Return File .csv found under ${RETURN_FILE_DIR}/ even after generating.`);
    }
    return files.map((f) => `${RETURN_FILE_DIR}/${f}`);
}

test.describe('Claims Intake — Return File Upload (DPS)', () => {
    // Writes to a real production Azure Blob Storage container — intentional,
    // same precedent as the other upload specs. Only runs under the `api`
    // project (see playwright.config.ts). DPS only for now — UB's return file
    // is a different format, not yet built pending its own field mapping.
    test('Generates a fresh SAS via the Portal, then uploads the DPS Return File through the API', async ({
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

        await logger.step('UPLOAD_RETURN_FILES', async () => {
            const sasUrl = scopeToFolder(new URL(blobServiceSasUrl), RETURN_FILE_FOLDER);
            checkSasNotExpired(sasUrl);

            const filePaths = await listReturnFiles();
            for (const filePath of filePaths) {
                const result = await uploadFileToBlob(sasUrl, filePath);
                await assert.toEqual(result.status, 201, `upload response status for ${filePath}`);
            }
        });
    });
});
