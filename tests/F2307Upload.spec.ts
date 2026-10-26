import { readdir } from 'fs/promises';
import path from 'path';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import { getChannelDir } from '../scripts/generate-intake-batches.ts';
import { generateF2307 } from '../scripts/generate-f2307.ts';

// Back under "testblob" (not "claimsblob", like Payment Journal/Disbursement)
// — same container as the original OPEML/memo uploads, new top-level folder.
const F2307_FOLDER = 'testblob/F2307 Output/COM_CHECK';

// F2307 now lives in ComCheck's shared test-data/COM CHECK/<date>/ folder,
// alongside that channel's intake file, memos, and Disbursement File — the
// "F2307_" filename prefix picks it out from the memo PDFs also sitting there.
const isF2307Filename = (f: string) => f.startsWith('F2307_') && f.toLowerCase().endsWith('.pdf');

async function listF2307Files(): Promise<string[]> {
    const dir = getChannelDir('COMCHECK');

    let files: string[];
    try {
        files = (await readdir(dir)).filter(isF2307Filename);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') files = [];
        else throw err;
    }

    if (files.length === 0) {
        await generateF2307();
        files = (await readdir(dir)).filter(isF2307Filename);
    }

    if (files.length === 0) {
        throw new Error(`No F2307 files found under ${dir}/ even after generating.`);
    }
    return files.map((f) => path.join(dir, f));
}

test.describe('Claims Intake — F2307 Upload (ComCheck)', () => {
    // Writes to a real production Azure Blob Storage container — intentional,
    // same precedent as the other upload specs. Only runs under the `api`
    // project (see playwright.config.ts).
    test('Generates a fresh SAS via the Portal, then uploads the ComCheck F2307 file through the API', async ({
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
