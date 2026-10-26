import { readdir } from 'fs/promises';
import path from 'path';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import { ALL_PAYMENT_MODES, generateIntakeBatches, getChannelDir, isIntakeFilename } from '../scripts/generate-intake-batches.ts';

const INTAKE_FOLDER = 'testblob/Out-Patient Teleconsulation';

// Intake files now live under each payment channel's own test-data/<CHANNEL>/<date>/
// folder, alongside that channel's other artifacts (memos, payment journal,
// etc.) — isIntakeFilename() picks out just the OPEML*.xlsx ones.
async function listXlsxFiles(): Promise<string[]> {
    const files: string[] = [];
    for (const mode of ALL_PAYMENT_MODES) {
        const channelDir = getChannelDir(mode);
        try {
            const entries = await readdir(channelDir);
            files.push(...entries.filter(isIntakeFilename).map((f) => path.join(channelDir, f)));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
    }
    return files;
}

// Picks up whatever is currently on disk rather than hardcoding filenames —
// scripts/generate-intake-batches.ts's own naming (date + daily counter)
// means hardcoded names wouldn't reliably exist by the time this runs.
// Generates a fresh batch on demand if nothing's found, rather than
// requiring a separate manual script run first.
async function listIntakeFiles(): Promise<string[]> {
    let files = await listXlsxFiles();
    if (files.length === 0) {
        await generateIntakeBatches();
        files = await listXlsxFiles();
    }

    if (files.length === 0) {
        throw new Error('No intake .xlsx files found under test-data/ even after running the generator.');
    }
    return files;
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
    // SAS via the "Shared access signature" blade, then uploads every intake
    // file currently across each channel's test-data/<CHANNEL>/<date>/ folder
    // through the same fast API call scripts/upload-intake-files.ts uses —
    // rather than driving the Portal's own (slower, heavier) Upload button.
    // One SAS, minted fresh this run, covers the whole batch — no per-file
    // expiry concern within one run.
    test('Generates a fresh SAS via the Portal, then uploads every intake file through the API', async ({
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
