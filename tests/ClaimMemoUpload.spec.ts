import { readdir } from 'fs/promises';
import path from 'path';
import { test } from '@fixtures/base.fixture.ts';
import { uiEndPoints } from '@constants/endpoint.config.ts';
import { checkSasNotExpired, scopeToFolder, uploadFileToBlob } from '@utils/blobUpload.util.ts';
import { generateIntakeBatches, getChannelDir, type PaymentMode } from '../scripts/generate-intake-batches.ts';
import { generateClaimMemos, readFailedRows } from '../scripts/generate-claim-memos.ts';

// Action Memo and Disapproval Memo are generated together as a pair by
// generateClaimMemos() — MediCard issues both documents together for a
// rejected claim (see that file's header comment). Merged into one spec
// (previously two) so there's only ever one place that can trigger
// generation — two separate specs each calling generateClaimMemos() as a
// fallback could otherwise race to generate the same pair at the same time
// if neither had run yet.
type MemoKind = {
    label: string;
    stepPrefix: 'ACTION_MEMOS' | 'DISAPPROVAL_MEMOS';
    suffix: '_am.pdf' | '_dm.pdf';
    // Note the folder spelling here ("Action_Memo"/"Disapproved_Memo" — past
    // tense, not "Disapproval" — and "OP_Teleconsultation") is deliberately
    // different from the OPEML upload folder ("Out-Patient Teleconsulation")
    // and from each other — both copied exactly from captured real requests,
    // not "corrected" to match.
    folder: string;
};

const MEMO_KINDS: MemoKind[] = [
    { label: 'Action Memo', stepPrefix: 'ACTION_MEMOS', suffix: '_am.pdf', folder: 'testblob/Action_Memo/OP_Teleconsultation' },
    { label: 'Disapproval Memo', stepPrefix: 'DISAPPROVAL_MEMOS', suffix: '_dm.pdf', folder: 'testblob/Disapproved_Memo/OP_Teleconsultation' },
];

const PAYMENT_MODES: PaymentMode[] = ['DPS', 'COMCHECK', 'UB'];

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

// Finds this run's memo PDFs (Action or Disapproval, per `kind`) for one
// payment mode — cross-references the OPEML xlsx files' recorded payment
// mode (readFailedRows, same source generate-claim-memos.ts itself uses)
// against the memo filenames' Control Code prefix, rather than assuming a
// fixed/hardcoded control code. Memos live in the same per-channel/date
// folder as the intake file they came from.
async function findMemosForPaymentMode(paymentMode: PaymentMode, kind: MemoKind): Promise<string[]> {
    const matchesMode = (row: { paymentMode: PaymentMode }) => row.paymentMode === paymentMode;

    // Not "failedRows.length === 0" — other channels can have rows (a
    // different payment mode entirely) without having one for this payment
    // mode specifically.
    let failedRows = await readFailedRows();
    let controlCodes = new Set(failedRows.filter(matchesMode).map((row) => row.controlCode));
    if (controlCodes.size === 0) {
        await generateIntakeBatches();
        failedRows = await readFailedRows();
        controlCodes = new Set(failedRows.filter(matchesMode).map((row) => row.controlCode));
    }

    if (controlCodes.size === 0) {
        throw new Error(`No OPEML rows found for ${paymentMode} — nothing to upload.`);
    }

    const memoDir = getChannelDir(paymentMode);
    const matchesControlCode = (f: string) =>
        f.toLowerCase().endsWith(kind.suffix) && [...controlCodes].some((code) => f.startsWith(code));

    // Same "check for this payment mode specifically, not just non-empty"
    // reasoning as the controlCodes check above. generateClaimMemos() writes
    // both Action and Disapproval Memos in one pass, so calling it from
    // either kind's lookup is equally correct — whichever kind asks first
    // generates both.
    let memoFiles = await readdir(memoDir).catch(() => [] as string[]);
    let matches = memoFiles.filter(matchesControlCode);
    if (matches.length === 0) {
        await generateClaimMemos();
        memoFiles = await readdir(memoDir).catch(() => [] as string[]);
        matches = memoFiles.filter(matchesControlCode);
    }

    if (matches.length === 0) {
        throw new Error(`No ${kind.label} PDFs found for ${paymentMode} under ${memoDir}/ even after generating.`);
    }
    return matches.map((f) => path.join(memoDir, f));
}

test.describe('Claims Intake — Action/Disapproval Memo Upload', () => {
    // Writes to a real production Azure Blob Storage container — intentional,
    // same precedent as IntakeUpload.spec.ts. Only runs under the `api`
    // project (see playwright.config.ts).
    //
    // One login/SAS generation covers both memo kinds and all three payment
    // modes — only the upload target folder changes (ComCheck nests one
    // level deeper), not the credential.
    test('Generates a fresh SAS via the Portal, then uploads every payment mode\'s Action and Disapproval Memo PDFs through the API', async ({
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

        for (const kind of MEMO_KINDS) {
            for (const paymentMode of PAYMENT_MODES) {
                await logger.step(`UPLOAD_${kind.stepPrefix}_${paymentMode}`, async () => {
                    const folder = resolveFolder(kind.folder, paymentMode);
                    const sasUrl = scopeToFolder(new URL(blobServiceSasUrl), folder);
                    checkSasNotExpired(sasUrl);

                    const filePaths = await findMemosForPaymentMode(paymentMode, kind);
                    for (const filePath of filePaths) {
                        const result = await uploadFileToBlob(sasUrl, filePath);
                        await assert.toEqual(result.status, 201, `upload response status for ${filePath}`);
                    }
                });
            }
        }
    });
});
