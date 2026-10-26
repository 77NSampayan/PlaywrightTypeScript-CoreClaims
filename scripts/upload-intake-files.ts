// Uploads one or more local files to the "Out-Patient Teleconsulation" folder
// in the Azure Blob Storage container the claims intake pipeline watches,
// using a SAS (Shared Access Signature) URL for auth — the same mechanism
// Azure Portal's own "Upload" button uses (a captured upload request from
// the Portal is what this script's request shape is modeled on).
//
// The actual upload/expiry-check logic lives in src/utils/blobUpload.util.ts,
// shared with tests/IntakeUpload.spec.ts — this file is just a thin CLI
// wrapper. It imports that module by relative path rather than the @utils
// alias: this script runs via plain `node`, whose native TypeScript support
// strips types but does not resolve tsconfig path aliases (only Playwright's
// own resolver does that), so @utils here would fail at runtime.
//
// The SAS URL is a live, time-limited WRITE credential — treat it exactly
// like a password:
//   - It is read from the INTAKE_BLOB_SAS_URL environment variable only,
//     never hardcoded here or logged. Add it to .env (not .env.example —
//     see the note in README's env var table) as:
//       INTAKE_BLOB_SAS_URL=https://mpinew.blob.core.windows.net/testblob/Out-Patient%20Teleconsulation?sv=...&sig=...
//     (everything up to and including the container/folder path, with the
//     SAS query string — no filename at the end; this script appends one
//     per upload).
//   - It expires (the `se=` query param) — when uploads start failing with
//     403 (or this script's own pre-check), generate a fresh SAS from the
//     Portal and update .env.
//
// Usage:
//     node scripts/upload-intake-files.ts <file1> [file2 ...]
//     node scripts/upload-intake-files.ts "test-data/DPS/10.05.26/OPEML2026100500060T.xlsx"

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkSasNotExpired, uploadFileToBlob } from '../src/utils/blobUpload.util.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(__dirname);

dotenv.config({ path: path.join(REPO_ROOT, '.env') });

function requireSasUrl(): URL {
    const raw = process.env.INTAKE_BLOB_SAS_URL;
    if (!raw) {
        throw new Error(
            'Missing INTAKE_BLOB_SAS_URL. Add it to .env — see the comment at the top of this script for the expected format.'
        );
    }
    return new URL(raw);
}

// Logs enough to identify the target without ever printing the SAS query
// string (the `sig=`/`se=`/etc. params are the live credential).
function describeForLogging(sasUrl: URL, fileName: string): string {
    return `${sasUrl.origin}${sasUrl.pathname.replace(/\/$/, '')}/${encodeURIComponent(fileName)}`;
}

async function main(): Promise<void> {
    const filePaths = process.argv.slice(2);
    if (filePaths.length === 0) {
        console.log('Usage: node scripts/upload-intake-files.ts <file1> [file2 ...]');
        process.exitCode = 1;
        return;
    }

    const sasUrl = requireSasUrl();
    checkSasNotExpired(sasUrl);

    for (const filePath of filePaths) {
        const fileName = path.basename(filePath);
        console.log(`Uploading ${fileName} -> ${describeForLogging(sasUrl, fileName)}`);
        const result = await uploadFileToBlob(sasUrl, filePath);
        console.log(`Uploaded ${fileName} (${result.status} ${result.statusText})`);
    }
}

await main();
