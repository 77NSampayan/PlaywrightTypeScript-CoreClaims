import { test } from '@fixtures/base.fixture.ts';
import type { DbConnection } from '@utils/db.util.ts';
import { DeSignalReader, fetchClaimDetailCounts, type SignalResult } from '@utils/deSignals.util.ts';
import { formatClock, formatTimestamp } from '@utils/tracker/trackerRules.util.ts';
import type { EligibleCode, StageUpdate } from '@utils/tracker/ControlCodeTracker.util.ts';
import type { WaitStage } from '@constants/tracker.config.ts';

const ACTOR = 'PipelineSignalCheck.spec.ts';

// In pipeline order, so a code that passes S6 in this run is evaluated for
// S7 in the same run (it'll normally be "not due" — its window just opened).
// S10 (email) isn't here: no mailbox access yet, so it's confirmed by hand.
const STAGES_CHECKED = ['S3_INTAKE_PROCESSED', 'S6_PAYMENT_PROCESSED', 'S7_PAYMENT_REFERENCE', 'S9_TRANSMITTAL_F2307'] as const satisfies readonly WaitStage[];
type CheckedStage = (typeof STAGES_CHECKED)[number];

type Check = { result: SignalResult; fields?: StageUpdate['fields'] };

const yesNo = (result: SignalResult) => (result.state === 'FOUND' ? 'Y' : 'N');

async function checkSignal(signals: DeSignalReader, dbConnection: DbConnection, stage: CheckedStage, code: EligibleCode): Promise<Check> {
    const { controlCode, channel } = code;

    switch (stage) {
        case 'S3_INTAKE_PROCESSED': {
            const result = await signals.intakeProcessed(controlCode);
            if (result.state !== 'FOUND') return { result };
            const counts = await fetchClaimDetailCounts(dbConnection, controlCode);
            return { result, fields: { deStatus: result.value ?? 'present', deClaimLines: counts.total, billedLines: counts.withBillCode } };
        }
        case 'S6_PAYMENT_PROCESSED':
            // COMCHECK's own "Disbursement processed" signal is still [TBC] —
            // the NAV pay ref row stands in for it, since it can't exist
            // before the Disbursement File was processed.
            return channel === 'COMCHECK'
                ? { result: await signals.navPayRef(controlCode), fields: { paymentSignalSource: 'de_nav_pay_ref (stand-in)' } }
                : { result: await signals.paymentJournalProcessed(controlCode), fields: { paymentSignalSource: 'de_payment_journal' } };
        case 'S7_PAYMENT_REFERENCE': {
            const result = channel === 'COMCHECK' ? await signals.navPayRef(controlCode) : await signals.epNumber(channel, controlCode);
            return result.state === 'FOUND' ? { result, fields: { paymentReference: result.value ?? 'present' } } : { result };
        }
        case 'S9_TRANSMITTAL_F2307': {
            const transmittal = await signals.transmittal(controlCode, code.row.settlementFileName as string | undefined);
            const f2307 = await signals.f2307Generation(controlCode);
            const fields = {
                transmittalFound: yesNo(transmittal),
                f2307Generated: yesNo(f2307),
                ...(f2307.state === 'FOUND' && f2307.value ? { f2307OutputPath: f2307.value } : {}),
            };
            const detail = `transmittal: ${transmittal.detail}; f2307: ${f2307.detail}`;
            if (transmittal.state === 'UNRESOLVED' || f2307.state === 'UNRESOLVED') return { result: { state: 'UNRESOLVED', detail }, fields };
            if (transmittal.state === 'FOUND' && f2307.state === 'FOUND') return { result: { state: 'FOUND', value: undefined, detail }, fields };
            return { result: { state: 'NOT_FOUND', detail }, fields };
        }
    }
}

// The swimlane's evidence record for a timeout: control code, file, upload
// time, elapsed (the Event Log's own column), last state.
function timeoutEvidence(code: EligibleCode, result: SignalResult): string {
    const file = code.row.settlementFileName ?? code.row.paymentFileName ?? `${code.controlCode}.xlsx`;
    const window = code.window;
    const opened = window ? formatTimestamp(window.start) : 'unknown';
    const deadline = window ? formatTimestamp(window.deadline) : 'unknown';
    return `file=${String(file)}; window opened=${opened}; deadline=${deadline}; last state=${result.detail}`;
}

test.describe('Control Code Tracker — DE signal checks', () => {
    // Read-only against the data_enrichment DB; writes only the tracker.
    // Single pass, not a polling loop: every code whose wait is due right now
    // is checked once, then the test ends. Re-run it after the "Next Check
    // At" the tracker shows — codes not due yet are left untouched, so
    // running it early is harmless.
    //
    // A miss before the deadline leaves the code WAITING (logged as
    // evidence); a miss after it is TIMED_OUT, which stops that code only —
    // never retried, re-uploaded or extended (swimlane "Waiting rules") —
    // and fails this test so the timeout is visible in the report.
    test('Advances every control code whose DE wait is due', async ({ dbConnection, tracker, assert, logger }) => {
        const signals = new DeSignalReader(dbConnection);
        const timedOut: string[] = [];
        const unresolved: string[] = [];
        let checked = 0;

        for (const stage of STAGES_CHECKED) {
            const { eligible, notDue } = await tracker.query(stage);
            for (const pending of notDue) {
                logger.info(`${pending.controlCode} ${stage}: not due until ${formatClock(pending.nextCheckAt)}`);
            }

            for (const code of eligible) {
                checked++;
                await logger.step(`CHECK_${stage}_${code.controlCode}`, async () => {
                    const { result, fields } = await checkSignal(signals, dbConnection, stage, code);
                    const update: StageUpdate = { detail: result.detail, ...(fields ? { fields } : {}) };

                    if (result.state === 'FOUND') {
                        await tracker.passStage(code.controlCode, stage, ACTOR, update);
                        if (stage === 'S6_PAYMENT_PROCESSED' && code.channel === 'COMCHECK') {
                            // Same de_nav_pay_ref row is S7's signal too —
                            // no point waiting another window to read it again.
                            await tracker.passStage(code.controlCode, 'S7_PAYMENT_REFERENCE', ACTOR, {
                                fields: { paymentReference: result.value ?? 'present' },
                                detail: 'same de_nav_pay_ref row as S6',
                            });
                        }
                    } else if (result.state === 'UNRESOLVED') {
                        // A lookup gap, not a DE miss — never times the code out.
                        unresolved.push(`${code.controlCode} ${stage}: ${result.detail}`);
                        await tracker.note(code.controlCode, `${stage}: signal lookup unresolved (${result.detail}) — confirm by hand`, ACTOR);
                        logger.warn(`${code.controlCode} ${stage}: signal lookup unresolved — ${result.detail}`);
                    } else if (code.overdue) {
                        timedOut.push(`${code.controlCode} ${stage}`);
                        await tracker.timeoutStage(code.controlCode, stage, ACTOR, `${stage}: no DE signal by the deadline`, {
                            ...update,
                            detail: timeoutEvidence(code, result),
                        });
                    } else {
                        await tracker.stillWaiting(code.controlCode, stage, ACTOR, update);
                    }
                });
            }
        }

        for (const description of unresolved) test.info().annotations.push({ type: 'warning', description });
        test.skip(checked === 0, 'No control code has a DE wait due right now — see "Next Check At" in the tracker.');

        await assert.toEqual(timedOut, [], 'control codes whose DE wait timed out (evidence in the tracker Event Log)');
    });
});
