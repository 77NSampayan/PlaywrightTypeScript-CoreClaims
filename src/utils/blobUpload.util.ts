// ─────────────────────────────────────────────
//  blobUpload.util.ts
//  Uploads a local file to the Azure Blob Storage
//  folder the claims intake pipeline watches, via
//  a SAS (Shared Access Signature) URL — the same
//  mechanism Azure Portal's own "Upload" button uses.
//
//  Deliberately has no SmartLogger dependency: it's
//  used both from a plain Node script (scripts/
//  upload-intake-files.ts, outside any Playwright
//  test context, where logger.action()'s test.step()
//  wrapping would throw) and from IntakeUpload.spec.ts
//  (which wraps the call in its own logger.step()).
// ─────────────────────────────────────────────

import { readFile } from 'fs/promises';
import path from 'path';

const CONTENT_TYPES: Record<string, string> = {
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pdf': 'application/pdf',
    '.csv': 'text/csv',
};

export type BlobUploadResult = {
    status: number;
    statusText: string;
};

/**
 * Fails fast on the SAS's own "se" (signed expiry) param rather than letting
 * every file in a batch round-trip to Azure just to each get a 403 — a SAS
 * is time-limited by design and gets regenerated often, so this is the
 * expected/normal failure mode, not an edge case.
 */
export function checkSasNotExpired(sasUrl: URL): void {
    const signedExpiry = sasUrl.searchParams.get('se');
    if (!signedExpiry) {
        throw new Error('SAS URL is missing its "se" (signed expiry) query param — is this a valid SAS URL?');
    }

    const expiresAt = new Date(signedExpiry);
    const msRemaining = expiresAt.getTime() - Date.now();
    if (msRemaining <= 0) {
        const minutesAgo = Math.round(-msRemaining / 60_000);
        throw new Error(
            `SAS URL expired ${minutesAgo} minute(s) ago (se=${signedExpiry}). Generate a fresh SAS and update .env.`
        );
    }
    if (msRemaining < 5 * 60_000) {
        console.warn(`Warning: this SAS token expires in under 5 minutes (at ${signedExpiry}).`);
    }
}

/**
 * Narrows an account-root SAS URL (e.g. the "Blob service SAS URL" the
 * Portal's "Shared access signature" form outputs — pathname "/") down to a
 * specific container/folder, so it matches the shape uploadFileToBlob()
 * expects (the same shape a manually-copied, already-folder-scoped SAS has).
 */
export function scopeToFolder(accountSasUrl: URL, folderPath: string): URL {
    const scoped = new URL(accountSasUrl.toString());
    const segments = folderPath.split('/').filter(Boolean).map(encodeURIComponent);
    scoped.pathname = `/${segments.join('/')}`;
    return scoped;
}

// Inserts the encoded filename as the last path segment, ahead of the SAS
// query string (a URL's query string must stay after every path segment).
function buildBlobUrl(sasUrl: URL, fileName: string): URL {
    const blobUrl = new URL(sasUrl.toString());
    blobUrl.pathname = `${sasUrl.pathname.replace(/\/$/, '')}/${encodeURIComponent(fileName)}`;
    return blobUrl;
}

/**
 * Uploads one local file to the SAS URL's folder. Does not check expiry
 * itself — call checkSasNotExpired() once before uploading a batch.
 */
export async function uploadFileToBlob(sasUrl: URL, filePath: string): Promise<BlobUploadResult> {
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) {
        throw new Error(`Unsupported file type "${ext}" for ${fileName} — add it to CONTENT_TYPES if this is expected.`);
    }

    const body = await readFile(filePath);
    const blobUrl = buildBlobUrl(sasUrl, fileName);

    // x-ms-version must match the SAS's own "sv" (signed version) param —
    // pulling it from the SAS itself rather than hardcoding it means this
    // keeps working if a future SAS is generated against a newer API version.
    const signedVersion = sasUrl.searchParams.get('sv');
    if (!signedVersion) {
        throw new Error('SAS URL is missing its "sv" (signed version) query param — is this a valid SAS URL?');
    }

    const response = await fetch(blobUrl, {
        method: 'PUT',
        headers: {
            'x-ms-version': signedVersion,
            'x-ms-date': new Date().toUTCString(),
            'x-ms-blob-type': 'BlockBlob',
            'x-ms-blob-content-type': contentType,
        },
        body,
    });

    if (!response.ok) {
        const responseBody = await response.text();
        throw new Error(`Upload failed for ${fileName}: ${response.status} ${response.statusText}\n${responseBody}`);
    }

    return { status: response.status, statusText: response.statusText };
}
