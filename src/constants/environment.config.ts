// ─────────────────────────────────────────────
//  environment.config.ts
//  Execution-environment configuration for the
//  authentication strategy — see AUTHENTICATION.md.
// ─────────────────────────────────────────────

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved from this file's own location (src/constants → ../..). */
const repoRoot = path.resolve(__dirname, '..', '..');

/**
 * Where an authenticated Playwright session is persisted for reuse.
 *
 * Already covered by `/playwright/.auth/` in .gitignore, and it must stay that
 * way: this file is a bearer token that has *already satisfied MFA*, so anyone
 * holding it bypasses the second factor entirely. Treat it as more sensitive
 * than the account password.
 */
export const STORAGE_STATE = path.join(repoRoot, 'playwright', '.auth', 'session.json');
