import { test } from '@fixtures/base.fixture.ts';
import type { DbConnection } from '@utils/db.util.ts';
import { DeSignalReader, fetchClaimDetailCounts, type SignalResult } from '@utils/deSignals.util.ts';
import { formatClock, formatTimestamp, nextCheckAfter } from '@utils/tracker/trackerRules.util.ts';
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
            // COMCHECK: DE loads the Disbursement File into de_nav_pay_ref.
            return channel === 'COMCHECK'
                ? { result: await signals.disbursementProcessed(code.row.paymentFileName as string | undefined), fields: { paymentSignalSource: 'de_nav_pay_ref' } }
                : { result: await signals.paymentJournalProcessed(controlCode), fields: { paymentSignalSource: 'de_payment_journal' } };
        case 'S7_PAYMENT_REFERENCE': {
            // COMCHECK skips S7 (CHANNEL_SKIPPED_STAGES), so it's never eligible here.
            if (channel === 'COMCHECK') return { result: { state: 'UNRESOLVED', detail: 'S7 is not part of the COMCHECK flow' } };
            const result = await signals.epNumber(channel, controlCode);
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

// A plain wait, not BasePage.waitForTimeout(): there is no page here, and
// nothing on the DB side signals "DE has run" — only the clock does.
const sleepUntil = (at: Date) => new Promise((resolve) => setTimeout(resolve, Math.max(0, at.getTime() - Date.now())));

const key = (stage: CheckedStage, controlCode: string) => `${stage} ${controlCode}`;

test.describe('Control Code Tracker — DE signal checks', () => {
    // Read-only against the data_enrichment DB; writes only the tracker.
    // Run it right after an upload: it waits for each code's first check,
    // re-checks after every DE run (S3: 2 min after :00/:15/:30/:45; other
    // stages every 5 min) and ends once every code has passed or reached
    // its deadline — about an hour at most. SIGNAL_CHECK_ONCE=1 makes one
    // pass instead (codes not due yet are left alone).
    //
    // A miss before the deadline leaves the code WAITING (logged as
    // evidence); a miss after it is TIMED_OUT, which stops that code only —
    // never retried, re-uploaded or extended (swimlane "Waiting rules") —
    // and fails this test so the timeout is visible in the report.
    test('Advances every control code whose DE wait is due', async ({ dbConnection, tracker, assert, logger }) => {
        const signals = new DeSignalReader(dbConnection);
        const once = !!process.env.SIGNAL_CHECK_ONCE;
        const startedAt = Date.now();
        const timedOut: string[] = [];
        const unresolved: string[] = [];
        // Lookup gaps aren't waited on: re-checking can't fix a config gap.
        const unresolvedKeys = new Set<string>();
        // When each code that missed is worth checking again (DE's next run).
        const recheckAt = new Map<string, Date>();
        let timeoutMs = 0;
        let checked = 0;

        for (;;) {
            await checkDueCodes();
            if (once) break;

            const now = new Date();
            const pending: { label: string; at: Date; deadline: Date }[] = [];
            for (const stage of STAGES_CHECKED) {
                const { eligible, notDue } = await tracker.query(stage);
                for (const code of notDue) {
                    pending.push({ label: key(stage, code.controlCode), at: code.nextCheckAt, deadline: code.deadline });
                }
                for (const code of eligible) {
                    const window = code.window;
                    if (!window || now >= window.deadline || unresolvedKeys.has(key(stage, code.controlCode))) continue;
                    pending.push({ label: key(stage, code.controlCode), at: recheckAt.get(key(stage, code.controlCode)) ?? now, deadline: window.deadline });
                }
            }
            if (pending.length === 0) break;

            const wakeAt = new Date(Math.min(...pending.map((p) => p.at.getTime())));
            const lastDeadline = Math.max(...pending.map((p) => p.deadline.getTime()));
            // Long enough for the latest deadline's check, plus margin.
            const needed = lastDeadline - startedAt + 10 * 60_000;
            if (needed > timeoutMs) {
                timeoutMs = needed;
                test.setTimeout(timeoutMs);
            }
            if (wakeAt > now) {
                logger.info(`Waiting until ${formatClock(wakeAt)} — ${pending.length} code wait(s) pending: ${pending.map((p) => p.label).join(', ')}`);
                await sleepUntil(wakeAt);
            }
        }

        async function checkDueCodes(): Promise<void> {
            for (const stage of STAGES_CHECKED) {
                const { eligible, notDue } = await tracker.query(stage);
                for (const pending of notDue) {
                    logger.info(`${pending.controlCode} ${stage}: not due until ${formatClock(pending.nextCheckAt)}`);
                }

                for (const code of eligible) {
                    const dueAt = recheckAt.get(key(stage, code.controlCode));
                    if (unresolvedKeys.has(key(stage, code.controlCode)) || (dueAt && dueAt > new Date())) continue;
                    checked++;
                    await logger.step(`CHECK_${stage}_${code.controlCode}`, async () => {
                        const { result, fields } = await checkSignal(signals, dbConnection, stage, code);
                        const update: StageUpdate = { detail: result.detail, ...(fields ? { fields } : {}) };

                        if (result.state === 'FOUND') {
                            // Drop an earlier run's "lookup unresolved" note for this stage — it's resolved now.
                            const staleNote = String(code.row.remarks ?? '').startsWith(`${stage}: signal lookup unresolved`);
                            await tracker.passStage(code.controlCode, stage, ACTOR, staleNote ? { ...update, remark: '' } : update);
                        } else if (result.state === 'UNRESOLVED') {
                            // A lookup gap, not a DE miss — never times the code out.
                            unresolvedKeys.add(key(stage, code.controlCode));
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
                            if (code.window) {
                                const next = nextCheckAfter(code.window, new Date());
                                recheckAt.set(key(stage, code.controlCode), next);
                                logger.info(`${code.controlCode} ${stage}: not there yet (${result.detail}) — next check ${formatClock(next)}`);
                            }
                        }
                    });
                }
            }
        }

        for (const description of unresolved) test.info().annotations.push({ type: 'warning', description });
        test.skip(checked === 0, once
            ? 'No control code has a DE wait due right now — see "Next Check At" in the tracker.'
            : 'No control code is waiting on a DE signal.');

        await assert.toEqual(timedOut, [], 'control codes whose DE wait timed out (evidence in the tracker Event Log)');
    });
});
