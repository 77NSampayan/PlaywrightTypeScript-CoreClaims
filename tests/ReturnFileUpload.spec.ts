import path from 'path';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import type { EligibleCode } from '@utils/tracker/ControlCodeTracker.util.ts';
import { generateDpsReturnFile, generateUbReturnFile } from '../scripts/generate-return-file.ts';

const ACTOR = 'ReturnFileUpload.spec.ts';

const RETURN_FILE: Record<'DPS' | 'UB', { folder: string; generate: typeof generateDpsReturnFile }> = {
    DPS: { folder: 'testblob/ReturnFile_OPTeleconsult/DPS', generate: generateDpsReturnFile },
    UB: { folder: 'testblob/ReturnFile_OPTeleconsult/UnionBank', generate: generateUbReturnFile },
};

// A Return File is keyed by doctor identity, not by claim (see
// generate-return-file.ts), so each channel gets ONE file per run, carrying
// one control code's EP Number. Prefer a POSITIVE-scenario code — the
// happy path is the one worth carrying through to Transmittal and email.
function pickCoveredCode(codes: EligibleCode[]): EligibleCode {
    return codes.find((code) => code.row.scenario === 'POSITIVE') ?? codes[0]!;
}

test.describe('Claims Intake — Return File Upload (DPS/UB)', () => {
    // Writes to a real production Azure Blob Storage container — intentional,
    // same precedent as the other upload specs. Only runs under the `api`
    // project (see playwright.config.ts). DPS and UB each have their own
    // subfolder under the same "ReturnFile_OPTeleconsult" parent.
    //
    // Stage S8 of the Control Code Tracker for DPS/UB: only codes whose EP
    // Number is confirmed (S7 PASSED). The code the shared file carries
    // moves on to S9; the channel's other due codes are marked NOT_COVERED
    // and end there, by design (one Return File per channel per run).
    test('Generates a fresh SAS via the Portal, then uploads the DPS and UB Return Files through the API', async ({
        azureStorageSasPage,
        tracker,
        assert,
        logger,
    }) => {
        const eligible = await tracker.getEligible('S8_SETTLEMENT_UPLOAD', { channels: ['DPS', 'UB'] });
        test.skip(eligible.length === 0, 'No DPS/UB control code is due for a Return File (needs S7 PASSED in the tracker).');

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

        for (const channel of ['DPS', 'UB'] as const) {
            const codes = eligible.filter((code) => code.channel === channel);
            if (codes.length === 0) continue;

            const covered = pickCoveredCode(codes);
            const { folder, generate } = RETURN_FILE[channel];
            let fileName = '';

            await logger.step(`UPLOAD_${channel}_RETURN_FILE`, async () => {
                await tracker.runStage(covered.controlCode, 'S8_SETTLEMENT_UPLOAD', ACTOR, async () => {
                    const generated = await generate({ controlCode: covered.controlCode, date: covered.folderDate });
                    if (!generated) throw new Error(`No ${channel} Return File generated (is PAYMENT_MODE_FILTER excluding ${channel}?).`);

                    // The generator looks the EP Number up itself; a file that
                    // doesn't carry the one S7 confirmed would never match in
                    // DE, so fail here (retryable) rather than upload it.
                    const confirmed = String(covered.row.paymentReference ?? '');
                    if (confirmed && generated.epNumber !== confirmed) {
                        throw new Error(`${channel} Return File EP Number "${generated.epNumber}" does not match the S7-confirmed "${confirmed}" — not uploaded.`);
                    }

                    fileName = path.basename(generated.filePath);
                    const result = await uploadFileToBlob(scopeToFolder(accountSasUrl, folder), generated.filePath);
                    await assert.toEqual(result.status, 201, `upload response status for ${fileName}`);
                    return {
                        fields: { settlementFileType: 'RETURN_FILE', settlementFileName: fileName, coveredByFile: 'Y', epNumberInFile: generated.epNumber },
                        detail: `${fileName} → ${folder}`,
                    };
                });

                for (const other of codes.filter((code) => code !== covered)) {
                    await tracker.markNotCovered(other.controlCode, 'S8_SETTLEMENT_UPLOAD', ACTOR, {
                        fields: { settlementFileType: 'RETURN_FILE', settlementFileName: fileName, coveredByFile: 'N' },
                        detail: `shared ${channel} Return File ${fileName} carries ${covered.controlCode}`,
                    });
                }
            });
        }
    });
});
