// ─────────────────────────────────────────────
//  db.util.ts
//  Thin connection wrappers for DB-backed specs —
//  MSSQL (DbConnection) and in-process SQLite Wasm
//  (SqliteWasmConnection). Both log through the
//  shared SmartLogger, same as every Playwright
//  action, so a query shows up as a step in the
//  console and the HTML report/trace viewer.
// ─────────────────────────────────────────────

import sql from 'mssql';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database as SqliteDatabase } from '@sqlite.org/sqlite-wasm';
import { logger } from '@utils/logger/SmartLogger.util.ts';
import { db_config } from '@root/playwright.config.ts';

export class DbConnection {

    private pool: sql.ConnectionPool | undefined;

    async connect(): Promise<void> {
        await logger.action(
            `Connecting to database "${db_config.database}"`,
            async () => {
                this.pool = await new sql.ConnectionPool({
                    server: db_config.server,
                    database: db_config.database,
                    user: db_config.user,
                    password: db_config.password,
                    port: db_config.port,
                    options: {
                        encrypt: true,
                        trustServerCertificate: false,
                    },
                }).connect();
            },
            `Connected to database "${db_config.database}"`,
            `Failed to connect to database "${db_config.database}"`
        );
    }

    async query<T = Record<string, unknown>>(queryText: string, description: string): Promise<sql.IResult<T>> {
        if (!this.pool) {
            throw new Error('DbConnection.connect() must succeed before query() can be called.');
        }

        return logger.action(
            `Running query "${description}"`,
            () => this.pool!.request().query<T>(queryText),
            (result) => `Query "${description}" returned ${result.recordset.length} row(s)`,
            `Query "${description}" failed`
        );
    }

    async close(): Promise<void> {
        await logger.action(
            'Closing database connection',
            async () => {
                await this.pool?.close();
                this.pool = undefined;
            },
            'Database connection closed',
            'Failed to close database connection'
        );
    }
}

/**
 * In-process SQLite database via `@sqlite.org/sqlite-wasm` — no server, no
 * driver socket, the engine runs in the same Node process as the test.
 *
 * Node.js support in that package is in-memory only (no OPFS/file
 * persistence outside a browser), so `filename` defaults to `:memory:` and
 * data does not survive past `close()`.
 */
export class SqliteWasmConnection {

    private db: SqliteDatabase | undefined;

    async connect(filename: string = ':memory:'): Promise<void> {
        await logger.action(
            `Connecting to SQLite Wasm database "${filename}"`,
            async () => {
                const sqlite3 = await sqlite3InitModule();
                this.db = new sqlite3.oo1.DB(filename, 'c');
            },
            `Connected to SQLite Wasm database "${filename}"`,
            `Failed to connect to SQLite Wasm database "${filename}"`
        );
    }

    async query<T = Record<string, unknown>>(queryText: string, description: string): Promise<T[]> {
        if (!this.db) {
            throw new Error('SqliteWasmConnection.connect() must succeed before query() can be called.');
        }

        return logger.action(
            `Running query "${description}"`,
            () => this.db!.exec(queryText, { returnValue: 'resultRows', rowMode: 'object' }) as T[],
            (rows) => `Query "${description}" returned ${rows.length} row(s)`,
            `Query "${description}" failed`
        );
    }

    /** Runs a DDL/DML statement (CREATE TABLE, INSERT, UPDATE, DELETE) that returns no rows. */
    async execute(sqlText: string, description: string): Promise<void> {
        if (!this.db) {
            throw new Error('SqliteWasmConnection.connect() must succeed before execute() can be called.');
        }

        await logger.action(
            `Executing "${description}"`,
            () => {
                this.db!.exec(sqlText);
            },
            `Executed "${description}"`,
            `Failed to execute "${description}"`
        );
    }

    /**
     * Creates the `claims` table and seeds it with synthetic rows — no real
     * claim or member data, just enough for a spec to query something real.
     * Called by the `sqliteConnection` fixture right after `connect()`, so
     * every test that declares `sqliteConnection` gets it pre-seeded.
     */
    async seedClaimsTable(): Promise<void> {
        await this.execute(
            `CREATE TABLE claims (
                id INTEGER PRIMARY KEY,
                claim_number TEXT NOT NULL,
                status TEXT NOT NULL
            )`,
            'create claims table'
        );

        await this.execute(
            `INSERT INTO claims (claim_number, status) VALUES
                ('CLM-1001', 'Approved'),
                ('CLM-1002', 'Pending'),
                ('CLM-1003', 'Denied')`,
            'seed claims table'
        );
    }

    async close(): Promise<void> {
        await logger.action(
            'Closing SQLite Wasm database connection',
            async () => {
                this.db?.close();
                this.db = undefined;
            },
            'SQLite Wasm database connection closed',
            'Failed to close SQLite Wasm database connection'
        );
    }
}
