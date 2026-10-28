// Runs one SQL query against one of the MSSQL databases the DB-backed specs
// use, and prints the result — for ad-hoc checks without writing a spec.
//
// Connects with the same env vars and options as DbConnection in
// src/utils/db.util.ts, but does not import it: that class logs through
// SmartLogger, whose logger.action() runs inside Playwright's test.step()
// (only available under the test runner), and it imports via the @utils
// alias, which plain `node` does not resolve (strip-only TypeScript, no
// tsconfig paths). So this script uses `mssql` directly.
//
// Credentials come from .env only (see README § Setup):
//     data-enrichment → DATA_ENRICHMENT_DB_SERVER / _NAME / _USER / _PASSWORD / _PORT
//     membership      → MEMBERSHIP_DB_SERVER     / _NAME / _USER / _PASSWORD / _PORT
// _PORT is optional (defaults to 1433). Nothing here prints a credential.
//
// Results may contain member data — print to your own terminal only; don't
// paste output into tickets, chat, or committed files.
//
// SELECT only, enforced twice:
//   1. assertSelectOnly() rejects the query before connecting unless every
//      statement is a SELECT (or a WITH … SELECT CTE) — no INSERT/UPDATE/
//      DELETE/MERGE, no DDL, no EXEC, no SELECT … INTO.
//   2. The query runs inside a transaction that is always rolled back, so
//      anything the keyword check misses still never commits.
// Neither replaces a read-only DB login — if these credentials can write,
// that is the real guarantee to ask the DBA for.
//
// Usage:
//     node scripts/run-query.ts [--db data-enrichment|membership] [--json] "<SQL>"
//     node scripts/run-query.ts [--db data-enrichment|membership] [--json] --file <path.sql>
//
//     node scripts/run-query.ts "SELECT TOP 10 name FROM sys.tables ORDER BY name"
//     node scripts/run-query.ts --db membership --file queries/check.sql --json > out.json

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(__dirname);

dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

const DB_PREFIXES: Record<string, string> = {
    'data-enrichment': 'DATA_ENRICHMENT_DB',
    'membership': 'MEMBERSHIP_DB',
};

const USAGE =
    'Usage: node scripts/run-query.ts [--db data-enrichment|membership] [--json] ("<SQL>" | --file <path.sql>)';

type Args = {
    prefix: string;
    queryText: string;
    json: boolean;
};

// Anything that writes, changes schema/permissions, runs code, or leaves the
// target database. INTO covers both INSERT INTO and SELECT … INTO (which
// creates a table). Matched as whole words, outside comments, string
// literals and [bracketed]/"quoted" identifiers.
const BLOCKED_KEYWORDS = [
    'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE', 'INTO',
    'CREATE', 'ALTER', 'DROP',
    'GRANT', 'REVOKE', 'DENY',
    'EXEC', 'EXECUTE', 'SP_EXECUTESQL',
    'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVE',
    'BACKUP', 'RESTORE', 'DBCC', 'KILL', 'SHUTDOWN', 'USE', 'WAITFOR',
    'BULK', 'OPENROWSET', 'OPENQUERY', 'OPENDATASOURCE', 'WRITETEXT', 'UPDATETEXT',
];

// Comments, string literals and delimited identifiers, in one alternation so
// whichever starts first wins (a `--` inside a string is not a comment).
const NON_CODE = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"/g;

function assertSelectOnly(queryText: string): void {
    const code = queryText.replace(NON_CODE, ' ');

    const firstWord = /^[\s;]*(\w+)/.exec(code)?.[1]?.toUpperCase();
    if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
        throw new Error(`Only SELECT queries are allowed — this one starts with "${firstWord ?? '(nothing)'}".`);
    }

    const blocked = new RegExp(`\\b(${BLOCKED_KEYWORDS.join('|')})\\b`, 'i').exec(code)?.[1];
    if (blocked) {
        throw new Error(
            `Only SELECT queries are allowed — found "${blocked.toUpperCase()}". ` +
            'If that is a column or table name, wrap it in [brackets].'
        );
    }
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}. Check your .env file.`);
    }
    return value;
}

function parseArgs(argv: string[]): Args {
    let dbName = 'data-enrichment';
    let file: string | undefined;
    let inlineSql: string | undefined;
    let json = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === '--db') {
            dbName = argv[++i] ?? '';
        } else if (arg === '--file') {
            file = argv[++i];
        } else if (arg === '--json') {
            json = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log(USAGE);
            process.exit(0);
        } else if (/^--\w/.test(arg)) { // not `-- comment` at the start of a query
            throw new Error(`Unknown option "${arg}".\n${USAGE}`);
        } else if (inlineSql === undefined) {
            inlineSql = arg;
        } else {
            throw new Error(`Unexpected extra argument. Quote the whole query as one argument.\n${USAGE}`);
        }
    }

    const prefix = DB_PREFIXES[dbName];
    if (!prefix) {
        throw new Error(`Unknown --db "${dbName}". Expected one of: ${Object.keys(DB_PREFIXES).join(', ')}.`);
    }
    if ((file === undefined) === (inlineSql === undefined)) {
        throw new Error(`Pass exactly one of an inline query or --file <path.sql>.\n${USAGE}`);
    }

    const queryText = file !== undefined ? fs.readFileSync(path.resolve(file), 'utf8') : inlineSql!;
    if (!queryText.trim()) {
        throw new Error('The query is empty.');
    }
    assertSelectOnly(queryText);
    return { prefix, queryText, json };
}

function configFromEnv(prefix: string): sql.config {
    const rawPort = process.env[`${prefix}_PORT`];
    const port = rawPort ? Number(rawPort) : 1433;
    if (!Number.isInteger(port)) {
        throw new Error(`${prefix}_PORT must be an integer, got "${rawPort}".`);
    }
    return {
        server: requireEnv(`${prefix}_SERVER`),
        database: requireEnv(`${prefix}_NAME`),
        user: requireEnv(`${prefix}_USER`),
        password: requireEnv(`${prefix}_PASSWORD`),
        port,
        options: {
            encrypt: true,
            trustServerCertificate: false,
        },
    };
}

async function main(): Promise<void> {
    const { prefix, queryText, json } = parseArgs(process.argv.slice(2));
    const config = configFromEnv(prefix);

    // Progress goes to stderr so `--json > out.json` captures only the rows.
    console.error(`Connecting to database "${config.database}"...`);
    const pool = await new sql.ConnectionPool(config).connect();
    try {
        const started = Date.now();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        let result: sql.IResult<Record<string, unknown>>;
        try {
            result = await new sql.Request(transaction).query(queryText);
        } finally {
            // Always roll back — the backstop for anything assertSelectOnly()
            // missed. A rollback error (e.g. the server already aborted the
            // transaction after a failed query) is safe to ignore: an
            // uncommitted transaction is rolled back when the pool closes.
            await transaction.rollback().catch(() => {});
        }
        const elapsed = Date.now() - started;

        // A batch can return several result sets (one per SELECT).
        const recordsets = (result.recordsets ?? []) as sql.IRecordSet<Record<string, unknown>>[];

        if (json) {
            console.log(JSON.stringify(recordsets.length === 1 ? recordsets[0] : recordsets, null, 2));
        } else {
            recordsets.forEach((rows, index) => {
                if (recordsets.length > 1) {
                    console.log(`\n── Result set ${index + 1} ──`);
                }
                if (rows.length > 0) {
                    console.table(rows);
                }
            });
        }

        const rowCounts = recordsets.map((rows) => rows.length).join(', ') || '0';
        console.error(`Done in ${elapsed}ms — rows returned: ${rowCounts}`);
    } finally {
        await pool.close();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
