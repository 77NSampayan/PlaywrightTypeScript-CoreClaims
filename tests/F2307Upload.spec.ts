import path from 'path';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import { generateF2307 } from '../scripts/generate-f2307.ts';

const ACTOR = 'F2307Upload.spec.ts';

// Back under "testblob" (not "claimsblob", like Payment Journal/Disbursement)
// — same container as the original OPEML/memo uploads, new top-level folder.
const F2307_FOLDER = 'testblob/F2307 Output/COM_CHECK';

test.describe('Claims Intake — F2307 Upload (ComCheck)', () => {
    // Writes to a real production Azure Blob Storage container — intentional,
    // same precedent as the other upload specs. Only runs under the `api`
    // project (see playwright.config.ts).
    //
    // Stage S8 of the Control Code Tracker for COMCHECK: only codes whose
    // NAV payment reference is confirmed (S7 PASSED). One F2307 per code
    // (F2307_<ControlCode>.pdf), generated from that code's own test-data
    // folder; passing opens S9's wait window.
    test('Generates a fresh SAS via the Portal, then uploads the ComCheck F2307 file through the API', async ({
        azureStorageSasPage,
        tracker,
        assert,
        logger,
    }) => {
        const eligible = await tracker.getEligible('S8_SETTLEMENT_UPLOAD', { channels: ['COMCHECK'] });
        test.skip(eligible.length === 0, 'No COMCHECK control code is due for an F2307 upload (needs S7 PASSED in the tracker).');

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

        const sasUrl = scopeToFolder(new URL(blobServiceSasUrl), F2307_FOLDER);
        checkSasNotExpired(sasUrl);

        for (const code of eligible) {
            await logger.step(`UPLOAD_F2307_${code.controlCode}`, async () => {
                await tracker.runStage(code.controlCode, 'S8_SETTLEMENT_UPLOAD', ACTOR, async () => {
                    const [f2307] = await generateF2307({ controlCodes: [code.controlCode], date: code.folderDate });
                    if (!f2307) throw new Error(`No F2307 generated for ${code.controlCode} (is PAYMENT_MODE_FILTER excluding COMCHECK?).`);

                    const fileName = path.basename(f2307.filePath);
                    const result = await uploadFileToBlob(sasUrl, f2307.filePath);
                    await assert.toEqual(result.status, 201, `upload response status for ${fileName}`);
                    return {
                        fields: { settlementFileType: 'F2307', settlementFileName: fileName, coveredByFile: 'Y' },
                        detail: `${fileName} → ${F2307_FOLDER}`,
                    };
                });
            });
        }
    });
});
