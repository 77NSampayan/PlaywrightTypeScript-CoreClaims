import path from 'path';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import type { PaymentMode } from '../scripts/generate-intake-batches.ts';
import { generateClaimMemos } from '../scripts/generate-claim-memos.ts';

const ACTOR = 'ClaimMemoUpload.spec.ts';

// Action Memo and Disapproval Memo are generated together as a pair by
// generateClaimMemos() — MediCard issues both documents together for a
// rejected claim (see that file's header comment). One spec uploads both,
// so there's only ever one place that triggers generation.
//
// Note the folder spelling here ("Action_Memo"/"Disapproved_Memo" — past
// tense, not "Disapproval" — and "OP_Teleconsultation") is deliberately
// different from the OPEML upload folder ("Out-Patient Teleconsulation")
// and from each other — both copied exactly from captured real requests,
// not "corrected" to match.
const ACTION_MEMO_FOLDER = 'testblob/Action_Memo/OP_Teleconsultation';
const DISAPPROVAL_MEMO_FOLDER = 'testblob/Disapproved_Memo/OP_Teleconsultation';

// ComCheck's memo uploads go into an extra nested subfolder; DPS and UB
// upload directly into the base folder. Confirmed from the real Portal
// breadcrumbs (.../OP_Teleconsultation/COM_CHECK for ComCheck specifically —
// DPS and UB have no such subfolder) — same for both memo kinds.
const PAYMENT_MODE_SUBFOLDER: Partial<Record<PaymentMode, string>> = {
    COMCHECK: 'COM_CHECK',
};

function resolveFolder(baseFolder: string, paymentMode: PaymentMode): string {
    const subfolder = PAYMENT_MODE_SUBFOLDER[paymentMode];
    return subfolder ? `${baseFolder}/${subfolder}` : baseFolder;
}

test.describe('Claims Intake — Action/Disapproval Memo Upload', () => {
    // Writes to a real production Azure Blob Storage container — intentional,
    // same precedent as IntakeUpload.spec.ts. Only runs under the `api`
    // project (see playwright.config.ts).
    //
    // Stage S2 of the Control Code Tracker: only codes whose intake upload
    // passed and that have at least one Action Memo = "Y" row. Memos are
    // generated from each code's own test-data folder, so a code uploaded
    // yesterday still finds its intake file.
    //
    // One login/SAS generation covers both memo kinds and all three payment
    // modes — only the upload target folder changes (ComCheck nests one
    // level deeper), not the credential.
    test('Generates a fresh SAS via the Portal, then uploads every payment mode\'s Action and Disapproval Memo PDFs through the API', async ({
        azureStorageSasPage,
        tracker,
        assert,
        logger,
    }) => {
        const { eligible } = await tracker.query('S2_MEMO_UPLOAD');
        test.skip(eligible.length === 0, 'No control code is due for memos (needs S1 PASSED and Action Memo = Y).');

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

        for (const code of eligible) {
            await logger.step(`UPLOAD_MEMOS_${code.controlCode}`, async () => {
                await tracker.runStage(code.controlCode, 'S2_MEMO_UPLOAD', ACTOR, async () => {
                    const pairs = await generateClaimMemos({ controlCodes: [code.controlCode], date: code.folderDate });
                    const actionSas = scopeToFolder(accountSasUrl, resolveFolder(ACTION_MEMO_FOLDER, code.channel));
                    const disapprovalSas = scopeToFolder(accountSasUrl, resolveFolder(DISAPPROVAL_MEMO_FOLDER, code.channel));

                    for (const pair of pairs) {
                        const am = await uploadFileToBlob(actionSas, pair.amPath);
                        await assert.toEqual(am.status, 201, `upload response status for ${path.basename(pair.amPath)}`);
                        const dm = await uploadFileToBlob(disapprovalSas, pair.dmPath);
                        await assert.toEqual(dm.status, 201, `upload response status for ${path.basename(pair.dmPath)}`);
                    }

                    // Counts, not file names: memo file names carry the member's name.
                    return {
                        fields: { amUploaded: pairs.length, dmUploaded: pairs.length },
                        detail: `${pairs.length} AM/DM pair(s) uploaded`,
                    };
                });
            });
        }
    });
});
