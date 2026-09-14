import { test } from '@fixtures/base.fixture.ts';
import { GenericAssertions } from '@base/GenericAssertions.util.ts';
import { logger } from '@utils/logger/SmartLogger.util.ts';

// Standalone plain-value assertions — no Locator/Page involved, so this
// doesn't live on a page object; see src/base/README.md.
const assert = new GenericAssertions(logger);

test.describe('Database Connectivity', () => {
    test('Connects to the database and runs a smoke-test query', async ({ dbConnection, logger }) => {
        await logger.step('RUN_SMOKE_QUERY', async () => {
            const result = await dbConnection.query<{ result: number }>(
                'SELECT 1 AS result',
                'connectivity smoke test'
            );

            await assert.toEqual(result.recordset.length, 1, 'smoke query row count');
            await assert.toEqual(result.recordset[0]?.result, 1, 'smoke query result value');
        });
    });
});

test.describe('SQLite Wasm', () => {
    test('Queries the pre-seeded claims table', async ({ sqliteConnection, logger }) => {
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
