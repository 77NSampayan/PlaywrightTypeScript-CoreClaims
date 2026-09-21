import { test } from '@fixtures/base.fixture.ts';
import { db_config, membership_db_config } from '@root/playwright.config.ts';

test.describe('Database Connectivity', () => {
    test('Connects to the database and runs a smoke-test query', async ({ dbConnection, assert, logger }) => {
        await logger.step('RUN_SMOKE_QUERY', async () => {
            const rows = await dbConnection.query<{ db: string }>(
                'SELECT DB_NAME() AS db',
                'connectivity smoke test'
            );

            await assert.toEqual(rows.length, 1, 'smoke query row count');
            await assert.toEqual(rows[0]?.db, db_config.database, 'connected database name');
        });
    });

    test('Connects to the Membership database and runs a smoke-test query', async ({ membershipDbConnection, assert, logger }) => {
        await logger.step('RUN_SMOKE_QUERY', async () => {
            const rows = await membershipDbConnection.query<{ db: string }>(
                'SELECT DB_NAME() AS db',
                'Membership connectivity smoke test'
            );

            await assert.toEqual(rows.length, 1, 'smoke query row count');
            await assert.toEqual(rows[0]?.db, membership_db_config.database, 'connected database name');
        });
    });
});

test.describe('SQLite Wasm', () => {
    // Capability spike, not product coverage: this only proves @sqlite.org/sqlite-wasm
    // runs in this Node/ESM setup — it asserts back the exact rows seedClaimsTable()
    // just inserted, so it can't fail for a Core Claims reason. Tagged @wip so it
    // doesn't read as claims coverage; see README.md's tag table.
    test('SQLite Wasm in-process engine is usable from Node', { tag: ['@wip'] }, async ({ sqliteConnection, assert, logger }) => {
        await logger.step('QUERY_SEEDED_CLAIMS_TABLE', async () => {
            const rows = await sqliteConnection.query<{ claim_number: string; status: string }>(
                'SELECT claim_number, status FROM claims ORDER BY id',
                'seeded claims rows'
            );

            await assert.toEqual(rows.length, 3, 'seeded claims row count');
            await assert.toEqual(rows[0]?.claim_number, 'CLM-1001', 'first claim number');
            await assert.toEqual(rows[0]?.status, 'Approved', 'first claim status');
        });
    });
});
