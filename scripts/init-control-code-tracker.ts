// Creates the Control Code Tracker workbook (test-data/control-code-tracker.xlsx)
// if it doesn't exist yet, then prints one line per control code: where it
// is in the pipeline and what to run next. Specs create the file on their
// own the first time they need it, so running this is optional — it's the
// quick "what's next?" view without opening Excel.
//
// Imports by relative path rather than @utils/@constants: plain `node` strips
// types but does not resolve tsconfig path aliases (see
// scripts/upload-intake-files.ts for the same note).
//
// Usage:
//     node scripts/init-control-code-tracker.ts

import { pathToFileURL } from 'url';
import { ControlCodeTracker } from '../src/utils/tracker/ControlCodeTracker.util.ts';

export async function printTrackerSummary(tracker: ControlCodeTracker = new ControlCodeTracker()): Promise<void> {
    await tracker.ensureExists();
    const { rows } = await tracker.read();
    console.log(`Tracker: ${tracker.filePath}`);

    if (rows.length === 0) {
        console.log('No control codes yet — run tests/IntakeUpload.spec.ts to register some.');
        return;
    }

    for (const row of rows) {
        console.log(
            `${String(row.controlCode).padEnd(21)} ${String(row.paymentChannel ?? '').padEnd(8)} ` +
            `${String(row.currentStage ?? '').padEnd(22)} ${String(row.currentStatus ?? '').padEnd(12)} ${row.nextStep ?? ''}`
        );
    }
}

// Runs automatically only when invoked directly, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await printTrackerSummary();
}
