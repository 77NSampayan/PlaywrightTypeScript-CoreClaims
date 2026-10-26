import { readdir } from 'fs/promises';
import path from 'path';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import { getChannelDir } from '../scripts/generate-intake-batches.ts';
import { generateDpsReturnFile, generateUbReturnFile } from '../scripts/generate-return-file.ts';

const DPS_RETURN_FILE_FOLDER = 'testblob/ReturnFile_OPTeleconsult/DPS';
const UB_RETURN_FILE_FOLDER = 'testblob/ReturnFile_OPTeleconsult/UnionBank';

// Return Files now live in their channel's shared test-data/<CHANNEL>/<date>/
// folder, alongside that channel's intake file (and, for DPS/UB, the Payment
// Journal too). DPS's return file is the only .csv in that folder, so the
// extension alone still disambiguates it; UB's is a .xlsx sharing the folder
// with intake/Payment Journal .xlsx files, so its PESONET_ filename prefix is
// needed too.
async function listMatchingFiles(dir: string, matches: (f: string) => boolean): Promise<string[]> {
    try {
        const files = await readdir(dir);
        return files.filter(matches).map((f) => path.join(dir, f));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
    }
}

async function listDpsReturnFiles(): Promise<string[]> {
    const dir = getChannelDir('DPS');
    const isDpsReturnFile = (f: string) => f.toLowerCase().endsWith('.csv');

    let files = await listMatchingFiles(dir, isDpsReturnFile);
    if (files.length === 0) {
        await generateDpsReturnFile();
        files = await listMatchingFiles(dir, isDpsReturnFile);
    }

    if (files.length === 0) {
        throw new Error(`No DPS Return File .csv found under ${dir}/ even after generating.`);
    }
    return files;
}

async function listUbReturnFiles(): Promise<string[]> {
    const dir = getChannelDir('UB');
    const isUbReturnFile = (f: string) => /^PESONET_/.test(f) && f.toLowerCase().endsWith('.xlsx');

    let files = await listMatchingFiles(dir, isUbReturnFile);
    if (files.length === 0) {
        await generateUbReturnFile();
        files = await listMatchingFiles(dir, isUbReturnFile);
    }

    if (files.length === 0) {
        throw new Error(`No UB Return File .xlsx found under ${dir}/ even after generating.`);
    }
    return files;
}

test.describe('Claims Intake — Return File Upload (DPS/UB)', () => {
    // Writes to a real production Azure Blob Storage container — intentional,
    // same precedent as the other upload specs. Only runs under the `api`
    // project (see playwright.config.ts). DPS and UB each have their own
    // subfolder under the same "ReturnFile_OPTeleconsult" parent.
    test('Generates a fresh SAS via the Portal, then uploads the DPS and UB Return Files through the API', async ({
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

        await logger.step('UPLOAD_DPS_RETURN_FILES', async () => {
            const sasUrl = scopeToFolder(new URL(blobServiceSasUrl), DPS_RETURN_FILE_FOLDER);
            checkSasNotExpired(sasUrl);

            const filePaths = await listDpsReturnFiles();
            for (const filePath of filePaths) {
                const result = await uploadFileToBlob(sasUrl, filePath);
                await assert.toEqual(result.status, 201, `upload response status for ${filePath}`);
            }
        });

        await logger.step('UPLOAD_UB_RETURN_FILES', async () => {
            const sasUrl = scopeToFolder(new URL(blobServiceSasUrl), UB_RETURN_FILE_FOLDER);
            checkSasNotExpired(sasUrl);

            const filePaths = await listUbReturnFiles();
            for (const filePath of filePaths) {
                const result = await uploadFileToBlob(sasUrl, filePath);
                await assert.toEqual(result.status, 201, `upload response status for ${filePath}`);
            }
        });
    });
});
