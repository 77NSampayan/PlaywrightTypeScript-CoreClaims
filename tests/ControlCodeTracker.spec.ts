import path from 'path';
import { utimes, writeFile } from 'fs/promises';
import ExcelJS from 'exceljs';
import { test } from '@fixtures/base.fixture.ts';
import { REPO_ROOT, type SkippedStages } from '@constants/tracker.config.ts';
import { ControlCodeTracker, summarizeError, type NewControlCode } from '@utils/tracker/ControlCodeTracker.util.ts';

// The Control Code Tracker's gating rules, against a throwaway workbook per
// test (testInfo.outputPath) and a fake clock — no browser, DB or Azure.
// Runs in the `db` project.

const DPS_DIR = path.join(REPO_ROOT, 'test-data', 'DPS', '10.26.26');
const COMCHECK_DIR = path.join(REPO_ROOT, 'test-data', 'COM CHECK', '10.26.26');

const NEGATIVE_CODE = 'OPEML2026102600001T';
const POSITIVE_CODE = 'OPEML2026102600004T';

function intake(controlCode: string, actionMemos: string[], channelDir = DPS_DIR, paymentChannel: NewControlCode['paymentChannel'] = 'DPS'): NewControlCode {
    return {
        controlCode,
        runId: 'RUN-TEST',
        channelDir,
        paymentChannel,
        claimRows: actionMemos.map((actionMemo, i) => ({ rowNumber: i + 1, transactionId: `TXN${i + 1}`, actionMemo })),
    };
}

/**
 * A tracker on its own file, with a clock the test moves by hand. No stages
 * skipped unless a test passes some, so the rules are tested whatever
 * SKIPPED_STAGES currently holds.
 */
function trackerAt(filePath: string, skippedStages: SkippedStages = {}) {
    const clock = { now: new Date(2026, 9, 26, 9, 0, 0) };
    const tracker = new ControlCodeTracker(filePath, () => clock.now, skippedStages);
    const setTime = (hours: number, minutes: number) => { clock.now = new Date(2026, 9, 26, hours, minutes, 0); };
    return { tracker, setTime };
}

async function eligibleCodes(tracker: ControlCodeTracker, stage: Parameters<ControlCodeTracker['getEligible']>[0]): Promise<string[]> {
    return (await tracker.getEligible(stage)).map((code) => code.controlCode);
}

test.describe('Control Code Tracker — gating rules', () => {

    test('Registers a code once, with memos N/A when no row is Action Memo = Y', async ({ assert }, testInfo) => {
        const { tracker } = trackerAt(testInfo.outputPath('tracker.xlsx'));

        const first = await tracker.register([intake(NEGATIVE_CODE, ['N', 'Y']), intake(POSITIVE_CODE, ['N', 'N'])], 'test');
        const second = await tracker.register([intake(NEGATIVE_CODE, ['N', 'Y'])], 'test');

        await assert.toEqual(first.added, [NEGATIVE_CODE, POSITIVE_CODE], 'codes added on first registration');
        await assert.toEqual(second.existing, [NEGATIVE_CODE], 'code reported as already tracked on re-registration');

        const { rows, claimRows } = await tracker.read();
        await assert.toEqual(rows.length, 2, 'tracker rows after registering twice');
        await assert.toEqual(claimRows.length, 4, 'claim rows after registering twice');
        await assert.toEqual(rows.map((r) => [r.scenario, r.actionMemo, r.s2Status]), [['NEGATIVE', 'Y', 'NOT_STARTED'], ['POSITIVE', 'N', 'N/A']], 'scenario / Action Memo / S2 status per code');
        await assert.toEqual(rows[0]?.testDataFolder, 'test-data/DPS/10.26.26', 'test data folder stored relative to the repo');
    });

    test('Offers a code for upload only once its intake file is created', async ({ assert }, testInfo) => {
        const { tracker } = trackerAt(testInfo.outputPath('tracker.xlsx'));
        await tracker.register([intake(POSITIVE_CODE, ['N'])], 'generator', { creationStatus: 'IN_PROGRESS' });

        const creating = await tracker.getRow(POSITIVE_CODE);
        await assert.toEqual([creating?.s0Status, creating?.currentStage], ['IN_PROGRESS', 'S0_INTAKE_CREATION'], 'S0 status and current stage while the file is being written');
        await assert.toEqual(await eligibleCodes(tracker, 'S1_INTAKE_UPLOAD'), [], 'S1-eligible codes while S0 is IN_PROGRESS');

        await tracker.passStage(POSITIVE_CODE, 'S0_INTAKE_CREATION', 'generator', { fields: { intakeFileName: `${POSITIVE_CODE}.xlsx` } });
        await assert.toEqual(await eligibleCodes(tracker, 'S1_INTAKE_UPLOAD'), [POSITIVE_CODE], 'S1-eligible codes once S0 passed');
    });

    test('Never offers an uploaded code for upload again', async ({ assert }, testInfo) => {
        const { tracker } = trackerAt(testInfo.outputPath('tracker.xlsx'));
        await tracker.register([intake(POSITIVE_CODE, ['N'])], 'test');

        await assert.toEqual(await eligibleCodes(tracker, 'S1_INTAKE_UPLOAD'), [POSITIVE_CODE], 'S1-eligible codes before upload');
        await tracker.runStage(POSITIVE_CODE, 'S1_INTAKE_UPLOAD', 'test', async () => ({}));
        await assert.toEqual(await eligibleCodes(tracker, 'S1_INTAKE_UPLOAD'), [], 'S1-eligible codes after upload');
    });

    test('Keeps a later stage closed until every earlier stage has passed', async ({ assert }, testInfo) => {
        const { tracker } = trackerAt(testInfo.outputPath('tracker.xlsx'));
        await tracker.register([intake(NEGATIVE_CODE, ['N', 'Y'])], 'test');
        await tracker.passStage(NEGATIVE_CODE, 'S1_INTAKE_UPLOAD', 'test');

        await assert.toEqual(await eligibleCodes(tracker, 'S5_PAYMENT_UPLOAD'), [], 'S5-eligible codes while S2-S4 are pending');
        await assert.toEqual(await eligibleCodes(tracker, 'S2_MEMO_UPLOAD'), [NEGATIVE_CODE], 'S2-eligible codes once S1 passed');
    });

    test('Opens a wait window at the previous stage, skipping N/A memos', async ({ assert }, testInfo) => {
        const { tracker, setTime } = trackerAt(testInfo.outputPath('tracker.xlsx'));
        await tracker.register([intake(POSITIVE_CODE, ['N'])], 'test');
        await tracker.passStage(POSITIVE_CODE, 'S1_INTAKE_UPLOAD', 'test'); // 09:00 — S2 is N/A, so S3's window opens here

        setTime(9, 10);
        const early = await tracker.query('S3_INTAKE_PROCESSED');
        await assert.toEqual(early.eligible.length, 0, 'S3-eligible codes 10 min in (min wait 15)');
        await assert.toEqual(early.notDue.map((n) => n.nextCheckAt.getMinutes()), [15], '"Next Check At" minute for the not-due code');

        setTime(9, 20);
        const due = await tracker.query('S3_INTAKE_PROCESSED');
        await assert.toEqual(due.eligible.map((c) => [c.controlCode, c.overdue]), [[POSITIVE_CODE, false]], 'S3-eligible codes 20 min in');

        setTime(10, 1);
        const late = await tracker.query('S3_INTAKE_PROCESSED');
        await assert.toEqual(late.eligible.map((c) => c.overdue), [true], 'overdue flag past the 60-min cap');

        const row = await tracker.getRow(POSITIVE_CODE);
        await assert.toEqual([row?.s3Status, row?.waitWindowStart], ['WAITING', '2026-10-26 09:00:00'], 'S3 status and window start in the sheet');
    });

    test('A timeout stops only that code, blocks its later stages and never re-offers it', async ({ assert }, testInfo) => {
        const { tracker, setTime } = trackerAt(testInfo.outputPath('tracker.xlsx'));
        await tracker.register([intake(POSITIVE_CODE, ['N']), intake(NEGATIVE_CODE, ['N'])], 'test');
        await tracker.passStage(POSITIVE_CODE, 'S1_INTAKE_UPLOAD', 'test');
        await tracker.passStage(NEGATIVE_CODE, 'S1_INTAKE_UPLOAD', 'test');

        setTime(10, 5);
        await tracker.timeoutStage(POSITIVE_CODE, 'S3_INTAKE_PROCESSED', 'test', 'no signal');

        const row = await tracker.getRow(POSITIVE_CODE);
        await assert.toEqual([row?.s3Status, row?.s4Status, row?.s10Status, row?.overallStatus], ['TIMED_OUT', 'BLOCKED', 'BLOCKED', 'MANUAL_INVESTIGATION'], 'timed-out code statuses');
        await assert.toEqual(await eligibleCodes(tracker, 'S3_INTAKE_PROCESSED'), [NEGATIVE_CODE], 'S3-eligible codes after the other one timed out');

        const { events } = await tracker.read();
        const timeout = events.find((e) => e.to === 'TIMED_OUT');
        await assert.toEqual(timeout?.elapsedMinutes, 65, 'elapsed minutes recorded with the timeout');
    });

    test('A code the shared Return File does not carry ends as NOT_COVERED', async ({ assert }, testInfo) => {
        const { tracker } = trackerAt(testInfo.outputPath('tracker.xlsx'));
        await tracker.register([intake(POSITIVE_CODE, ['N'])], 'test');
        await tracker.markNotCovered(POSITIVE_CODE, 'S8_SETTLEMENT_UPLOAD', 'test', { fields: { coveredByFile: 'N' } });

        const row = await tracker.getRow(POSITIVE_CODE);
        await assert.toEqual([row?.s8Status, row?.overallStatus, row?.coveredByFile], ['NOT_COVERED', 'ENDED_NOT_COVERED', 'N'], 'not-covered code statuses');
        await assert.toEqual(await eligibleCodes(tracker, 'S9_TRANSMITTAL_F2307'), [], 'S9-eligible codes');
    });

    test('Does not re-enter an ended code when an earlier stage is cleared by hand', async ({ assert }, testInfo) => {
        const { tracker } = trackerAt(testInfo.outputPath('tracker.xlsx'));
        await tracker.register([intake(POSITIVE_CODE, ['N'])], 'test');
        // S1 left NOT_STARTED while S8 already says NOT_COVERED — the shape a
        // hand-reset of an earlier stage leaves behind.
        await tracker.markNotCovered(POSITIVE_CODE, 'S8_SETTLEMENT_UPLOAD', 'test');

        await assert.toEqual(await eligibleCodes(tracker, 'S1_INTAKE_UPLOAD'), [], 'S1-eligible codes while S8 is NOT_COVERED');
    });

    test('Re-offers an IN_PROGRESS stage only once it is stale', async ({ assert }, testInfo) => {
        const { tracker, setTime } = trackerAt(testInfo.outputPath('tracker.xlsx'));
        await tracker.register([intake(POSITIVE_CODE, ['N'])], 'test');
        await tracker.startStage(POSITIVE_CODE, 'S1_INTAKE_UPLOAD', 'test'); // 09:00, then the run "crashes"

        setTime(9, 5);
        await assert.toEqual(await eligibleCodes(tracker, 'S1_INTAKE_UPLOAD'), [], 'S1-eligible codes 5 min into an upload');
        setTime(9, 20);
        await assert.toEqual(await eligibleCodes(tracker, 'S1_INTAKE_UPLOAD'), [POSITIVE_CODE], 'S1-eligible codes once the upload is 20 min stale');
    });

    test('Records a failed upload as retryable, with the error first line and no SAS signature', async ({ assert }, testInfo) => {
        const { tracker } = trackerAt(testInfo.outputPath('tracker.xlsx'));
        await tracker.register([intake(POSITIVE_CODE, ['N'])], 'test');

        let threw = false;
        try {
            await tracker.runStage(POSITIVE_CODE, 'S1_INTAKE_UPLOAD', 'test', async () => {
                throw new Error('Upload failed for X.xlsx: 403 Forbidden https://a/b?sv=1&sig=SECRET\n<Error>details</Error>');
            });
        } catch {
            threw = true;
        }

        const row = await tracker.getRow(POSITIVE_CODE);
        await assert.toEqual(threw, true, 'runStage rethrows the failure');
        await assert.toEqual([row?.s1Status, row?.remarks], ['FAILED', 'Upload failed for X.xlsx: 403 Forbidden https://a/b?sv=1&sig=***'], 'failed status and redacted remark');
        await assert.toEqual(await eligibleCodes(tracker, 'S1_INTAKE_UPLOAD'), [POSITIVE_CODE], 'S1-eligible codes after a failed upload');
        await assert.toEqual(summarizeError('plain'), 'plain', 'summary of a one-line error');
    });

    test('Treats a hand-typed unknown status as not eligible, never as not started', async ({ assert }, testInfo) => {
        const filePath = testInfo.outputPath('tracker.xlsx');
        const { tracker } = trackerAt(filePath);
        await tracker.register([intake(POSITIVE_CODE, ['N'])], 'test');

        // Simulate someone typing "DONE?" into S1 Status in Excel.
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const sheet = workbook.getWorksheet('Tracker')!;
        const statusCol = (sheet.getRow(2).values as unknown[]).indexOf('S1 Status');
        sheet.getRow(3).getCell(statusCol).value = 'DONE?';
        await workbook.xlsx.writeFile(filePath);

        await assert.toEqual(await eligibleCodes(tracker, 'S1_INTAKE_UPLOAD'), [], 'S1-eligible codes with an unknown status');
    });

    test('Reads wait windows back from the Config sheet', async ({ assert }, testInfo) => {
        const filePath = testInfo.outputPath('tracker.xlsx');
        const { tracker, setTime } = trackerAt(filePath);
        await tracker.register([intake(POSITIVE_CODE, ['N'], COMCHECK_DIR, 'COMCHECK')], 'test');
        await tracker.passStage(POSITIVE_CODE, 'S1_INTAKE_UPLOAD', 'test');

        // Shorten S3's cap to 20 min, as a person would in the sheet.
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const config = workbook.getWorksheet('Config')!;
        config.eachRow((row) => {
            if (row.getCell(1).value === 'S3_INTAKE_PROCESSED') row.getCell(3).value = 20;
        });
        await workbook.xlsx.writeFile(filePath);

        setTime(9, 25);
        const due = await tracker.query('S3_INTAKE_PROCESSED');
        await assert.toEqual(due.eligible.map((c) => c.overdue), [true], 'overdue flag 25 min in, with a 20-min cap');
        await assert.toEqual(due.eligible[0]?.folderDate.getDate(), 26, 'folder date parsed from the COM CHECK folder');
    });

    test('Keeps every change when writers run concurrently, and clears a stale lock', async ({ assert }, testInfo) => {
        const filePath = testInfo.outputPath('tracker.xlsx');
        const { tracker } = trackerAt(filePath);
        const codes = Array.from({ length: 6 }, (_, i) => `OPEML20261026${String(i + 10).padStart(5, '0')}T`);
        await tracker.register(codes.map((code) => intake(code, ['N'])), 'test');

        // A lock left behind by a crashed run, 5 min old.
        const lockPath = `${filePath}.lock`;
        await writeFile(lockPath, 'crashed');
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
        await utimes(lockPath, fiveMinutesAgo, fiveMinutesAgo);

        await Promise.all(codes.map((code) => new ControlCodeTracker(filePath).passStage(code, 'S1_INTAKE_UPLOAD', 'parallel')));

        const { rows } = await tracker.read();
        await assert.toEqual(rows.map((r) => r.s1Status), codes.map(() => 'PASSED'), 'S1 status of every concurrently-updated code');
    });

    test('Skips a listed stage as N/A as soon as a code reaches it, opening the next stage', async ({ assert }, testInfo) => {
        const reason = 'S3 skipped: test reason';
        const { tracker } = trackerAt(testInfo.outputPath('tracker.xlsx'), { S3_INTAKE_PROCESSED: reason });
        await tracker.register([intake(POSITIVE_CODE, ['N']), intake(NEGATIVE_CODE, ['N', 'Y'])], 'test');
        await tracker.passStage(POSITIVE_CODE, 'S1_INTAKE_UPLOAD', 'test'); // S2 is N/A, so S3 is next
        await tracker.passStage(NEGATIVE_CODE, 'S1_INTAKE_UPLOAD', 'test'); // S2 still to do

        const positive = await tracker.getRow(POSITIVE_CODE);
        await assert.toEqual([positive?.s3Status, positive?.currentStage, positive?.remarks], ['N/A', 'S4_CORECLAIMS_VISIBLE', reason], 'S3 status, current stage and remark once S1 passed');
        await assert.toEqual((await tracker.getRow(NEGATIVE_CODE))?.s3Status, undefined, 'S3 untouched while S2 is still to do');
        await assert.toEqual(await eligibleCodes(tracker, 'S4_CORECLAIMS_VISIBLE'), [POSITIVE_CODE], 'S4-eligible codes with S3 skipped');

        await tracker.passStage(NEGATIVE_CODE, 'S2_MEMO_UPLOAD', 'test');
        await assert.toEqual(await eligibleCodes(tracker, 'S4_CORECLAIMS_VISIBLE'), [POSITIVE_CODE, NEGATIVE_CODE], 'S4-eligible codes once the memo upload passed too');

        const { events } = await tracker.read();
        const skip = events.find((e) => e.controlCode === POSITIVE_CODE && e.stage === 'S3_INTAKE_PROCESSED');
        await assert.toEqual([skip?.from, skip?.to, skip?.detail], ['NOT_STARTED', 'N/A', reason], 'Event Log entry for the skip');
    });

    test('Skips a listed stage a code had already reached before it was listed', async ({ assert }, testInfo) => {
        const filePath = testInfo.outputPath('tracker.xlsx');
        const before = trackerAt(filePath).tracker;
        await before.register([intake(POSITIVE_CODE, ['N']), intake(NEGATIVE_CODE, ['N', 'Y'])], 'test');
        await before.passStage(POSITIVE_CODE, 'S1_INTAKE_UPLOAD', 'test');
        await assert.toEqual((await before.getRow(POSITIVE_CODE))?.s3Status, 'WAITING', 'S3 status before the stage was skipped');

        const { tracker } = trackerAt(filePath, { S3_INTAKE_PROCESSED: 'S3 skipped: test reason' });
        await assert.toEqual(await tracker.applySkippedStages('test'), [POSITIVE_CODE], 'codes skipped (the other has not reached S3)');
        await assert.toEqual((await tracker.getRow(POSITIVE_CODE))?.s3Status, 'N/A', 'S3 status after applying the skip');
        await assert.toEqual(await eligibleCodes(tracker, 'S4_CORECLAIMS_VISIBLE'), [POSITIVE_CODE], 'S4-eligible codes after applying the skip');
        await assert.toEqual(await tracker.applySkippedStages('test'), [], 'codes skipped by a second call');
    });
});
