import { readdir } from 'fs/promises';
import path from 'path';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import { newRunId } from '@utils/tracker/ControlCodeTracker.util.ts';
import { ALL_PAYMENT_MODES, generateIntakeBatches, getChannelDir, isIntakeFilename, readIntakeRows, type PaymentMode } from '../scripts/generate-intake-batches.ts';

const INTAKE_FOLDER = 'testblob/Out-Patient Teleconsulation';
const ACTOR = 'IntakeUpload.spec.ts';

type IntakeFile = { filePath: string; channelDir: string; paymentMode: PaymentMode; controlCode: string };

// Intake files now live under each payment channel's own test-data/<CHANNEL>/<date>/
// folder, alongside that channel's other artifacts (memos, payment journal,
// etc.) — isIntakeFilename() picks out just the OPEML*.xlsx ones. The file
// name is the Control Code (generate-intake-batches.ts's buildFilename()).
async function listXlsxFiles(): Promise<IntakeFile[]> {
    const files: IntakeFile[] = [];
    for (const mode of ALL_PAYMENT_MODES) {
        const channelDir = getChannelDir(mode);
        try {
            const entries = await readdir(channelDir);
            files.push(...entries.filter(isIntakeFilename).map((f) => ({
                filePath: path.join(channelDir, f),
                channelDir,
                paymentMode: mode,
                controlCode: path.basename(f, path.extname(f)),
            })));
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
// requiring a separate manual script run first. This is the one stage
// allowed to do that: S1 is where control codes are born, so nothing
// downstream can be holding a code the new batch doesn't know about.
async function listIntakeFiles(): Promise<IntakeFile[]> {
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
    // file across each channel's test-data/<CHANNEL>/<date>/ folder that the
    // Control Code Tracker hasn't already recorded as uploaded, through the
    // same fast API call scripts/upload-intake-files.ts uses — rather than
    // driving the Portal's own (slower, heavier) Upload button. One SAS,
    // minted fresh this run, covers the whole batch — no per-file expiry
    // concern within one run.
    //
    // Stage S1 of the tracker: registers each new control code, then never
    // re-uploads one already marked PASSED — the swimlane's "no re-upload"
    // rule — so re-running this is safe.
    test('Generates a fresh SAS via the Portal, then uploads every intake file through the API', async ({
        azureStorageSasPage,
        tracker,
        assert,
        logger,
    }) => {
        const filesByCode = new Map<string, IntakeFile>();

        await logger.step('REGISTER_CONTROL_CODES_IN_TRACKER', async () => {
            const files = await listIntakeFiles();
            const runId = newRunId();
            const entries = [];
            for (const file of files) {
                filesByCode.set(file.controlCode, file);
                const rows = await readIntakeRows(file.filePath);
                entries.push({
                    controlCode: file.controlCode,
                    runId,
                    channelDir: file.channelDir,
                    paymentChannel: file.paymentMode,
                    claimRows: rows.map(({ rowNumber, transactionId, actionMemo }) => ({ rowNumber, transactionId, actionMemo })),
                });
            }
            // Normally a no-op: generate-intake-batches.ts registers every code it
            // creates (stage S0). This catches files made before the tracker
            // existed, or copied in by hand — on disk, so S0 counts as PASSED.
            const { added, existing } = await tracker.register(entries, ACTOR, { detail: 'intake file found on disk' });
            logger.info(`Tracker: ${existing.length} control code(s) already tracked, ${added.length} newly registered from disk`);
        });

        // Only codes the tracker says still need S1 — and only those whose
        // file is actually on disk today (an older code's folder isn't scanned).
        const toUpload = (await tracker.getEligible('S1_INTAKE_UPLOAD'))
            .map((code) => filesByCode.get(code.controlCode))
            .filter((file): file is IntakeFile => file !== undefined);
        test.skip(toUpload.length === 0, 'Every intake file on disk is already uploaded (S1 PASSED in the Control Code Tracker).');

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

            for (const file of toUpload) {
                await tracker.runStage(file.controlCode, 'S1_INTAKE_UPLOAD', ACTOR, async () => {
                    const result = await uploadFileToBlob(sasUrl, file.filePath);
                    await assert.toEqual(result.status, 201, `upload response status for ${file.filePath}`);
                    return { detail: `${path.basename(file.filePath)} → ${INTAKE_FOLDER}` };
                });
                logger.info(`Tracker: ${file.controlCode} S1 → PASSED`);
            }
        });
    });
});
