// ─────────────────────────────────────────────
//  environment.config.ts
//  Execution-environment configuration for
//  signed-in session reuse (see tests/auth.setup.ts).
// ─────────────────────────────────────────────

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved from this file's own location (src/constants → ../..). */
const repoRoot = path.resolve(__dirname, '..', '..');

/**
 * Where the authenticated session of test account `index` (0-based, matching
 * `test_accounts` in playwright.config.ts) is persisted for reuse — written by
 * tests/auth.setup.ts, loaded by the worker with that `parallelIndex`.
 *
 * Already covered by `/playwright/.auth/` in .gitignore, and it must stay that
 * way: each file is a bearer token that has *already satisfied MFA*, so anyone
 * holding it bypasses the second factor entirely. Treat it as more sensitive
 * than the account password.
 */
export function storageStateFor(index: number): string {
    return path.join(repoRoot, 'playwright', '.auth', `session-${index}.json`);
}
/**
 * Session saved by tests/test.auth.spec.ts after signing in to Outlook on the web.
 *
 * Same gitignored folder and same warning as {@link storageStateFor} — and this
 * one also opens the account's mailbox, so it must never leave the machine.
 */
export const OUTLOOK_STORAGE_STATE = path.join(repoRoot, 'playwright', '.auth', 'outlook-session.json');
