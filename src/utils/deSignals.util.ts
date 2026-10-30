// ─────────────────────────────────────────────
//  deSignals.util.ts
//  Read-only lookups for the Data Enrichment (DE)
//  signals each Control Code Tracker wait stage
//  waits on — "has DE processed this yet?".
//
//  Several of these tables' key columns are still
//  [TBC] in the swimlane, so the control-code
//  column is found at run time from INFORMATION_
//  SCHEMA (exact names first, then a looser match)
//  instead of guessed in code. If it can't be
//  pinned to exactly one column, the lookup returns
//  UNRESOLVED — which a check must never treat as
//  "not there yet": a guessed miss would time a
//  code out for a config gap, not a DE problem.
// ─────────────────────────────────────────────

import type { DbConnection } from '@utils/db.util.ts';
import type { PaymentChannel } from '@constants/tracker.config.ts';

export type SignalResult =
    | { state: 'FOUND'; value: string | undefined; detail: string }
    | { state: 'NOT_FOUND'; detail: string }
    | { state: 'UNRESOLVED'; detail: string };

/**
 * DbConnection.query() takes raw SQL with no parameter binding, so a control
 * code is checked against an allowlist before it's interpolated — always
 * plain alphanumeric (OPEML…T).
 */
export function assertSafeControlCode(controlCode: string): void {
    if (!/^[A-Za-z0-9]+$/.test(controlCode)) {
        throw new Error(`Control code "${controlCode}" contains unexpected characters — refusing to build a query from it.`);
    }
}

function assertSafeFileName(fileName: string): void {
    if (!/^[A-Za-z0-9_.\- ]+$/.test(fileName)) {
        throw new Error(`File name "${fileName}" contains unexpected characters — refusing to build a query from it.`);
    }
}

// Column names come from INFORMATION_SCHEMA, not user input, but are still
// bracket-quoted and refused if they could break out of the brackets.
function quoteIdentifier(name: string): string {
    if (name.includes(']')) throw new Error(`Unexpected column name "${name}".`);
    return `[${name}]`;
}

const CONTROL_COLUMN_PATTERNS = [/^control_code$/i, /^control_no$/i, /^reference_control_no$/i, /control_?(code|no)/i];

export type ClaimDetailCounts = { total: number; withBillCode: number };

// Ground truth is DE's own processed-claims table, not our local intake
// file — a control code can be split into more than one claim line once DE
// actually processes it (confirmed against dbo.de_op_tc_claim_details: 2 rows,
// 2 distinct medicard_bill_code values, for one control_code). Each
// medicard_bill_code is what Claims Query's "Account Ref. No." column shows.
// SUM() over zero matching rows returns NULL (not 0), hence the `?? 0`.
export async function fetchClaimDetailCounts(dbConnection: DbConnection, controlCode: string): Promise<ClaimDetailCounts> {
    assertSafeControlCode(controlCode);

    const rows = await dbConnection.query<{ total: number; with_bill_code: number | null }>(
        `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN medicard_bill_code IS NOT NULL AND medicard_bill_code <> '' THEN 1 ELSE 0 END) AS with_bill_code
         FROM [dbo].[de_op_tc_claim_details]
         WHERE control_code = '${controlCode}'`,
        `claim detail counts for control code "${controlCode}"`
    );

    return {
        total: rows[0]?.total ?? 0,
        withBillCode: rows[0]?.with_bill_code ?? 0,
    };
}

type Lookup = { column: string } | { unresolved: string };

export class DeSignalReader {

    // One INFORMATION_SCHEMA query per table per run, not per control code.
    private readonly columnCache = new Map<string, string[]>();
    private readonly dbConnection: DbConnection;

    constructor(dbConnection: DbConnection) {
        this.dbConnection = dbConnection;
    }

    private async columnsOf(table: string): Promise<string[]> {
        const cached = this.columnCache.get(table);
        if (cached) return cached;

        const rows = await this.dbConnection.query<{ COLUMN_NAME: string }>(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`,
            `column names of ${table}`
        );
        const columns = rows.map((row) => row.COLUMN_NAME);
        this.columnCache.set(table, columns);
        return columns;
    }

    /** First pattern (in priority order) that matches exactly one column wins; two or more is ambiguous. */
    private async findColumn(table: string, patterns: RegExp[], exclude: string[] = []): Promise<Lookup> {
        const columns = (await this.columnsOf(table)).filter((c) => !exclude.includes(c));
        if (columns.length === 0) return { unresolved: `table ${table} not found (or has no columns)` };

        for (const pattern of patterns) {
            const candidates = columns.filter((c) => pattern.test(c));
            if (candidates.length === 1) return { column: candidates[0]! };
            if (candidates.length > 1) return { unresolved: `${table}: ambiguous column for ${pattern} (${candidates.join(', ')})` };
        }
        return { unresolved: `${table}: no column matching ${patterns.map(String).join(' / ')}` };
    }

    private async firstRowWhere(table: string, where: string, description: string): Promise<Record<string, unknown> | undefined> {
        const rows = await this.dbConnection.query<Record<string, unknown>>(
            `SELECT TOP 1 * FROM [dbo].[${table}] WHERE ${where}`,
            description
        );
        return rows[0];
    }

    /** Looks a control code up in `table` by its (discovered) control-code column. */
    private async byControlCode(table: string, controlCode: string, valuePatterns: RegExp[] = []): Promise<SignalResult> {
        assertSafeControlCode(controlCode);
        const key = await this.findColumn(table, CONTROL_COLUMN_PATTERNS);
        if ('unresolved' in key) return { state: 'UNRESOLVED', detail: key.unresolved };

        const row = await this.firstRowWhere(table, `${quoteIdentifier(key.column)} = '${controlCode}'`, `${table} row for control code "${controlCode}"`);
        if (!row) return { state: 'NOT_FOUND', detail: `no ${table} row where ${key.column} = ${controlCode}` };

        let value: string | undefined;
        if (valuePatterns.length > 0) {
            const valueColumn = await this.findColumn(table, valuePatterns, [key.column]);
            if ('column' in valueColumn) value = String(row[valueColumn.column] ?? '').trim() || undefined;
        }
        return { state: 'FOUND', value, detail: `${table} row found by ${key.column}` };
    }

    // ─── Stage signals ──────────────────────────────

    /**
     * S3 — intake processed: DE's file tracker lists the intake file as DONE.
     * Columns confirmed against dbo.de_op_file_tracker (file_name =
     * "<control code>.xlsx", status DONE once the 15-minute job has run), so
     * no column discovery here. Any other status keeps the code waiting, with
     * the status in the evidence. The newest row wins if the file was
     * uploaded more than once. The time is converted to text in SQL: mssql
     * would read a datetime as UTC and shift it 8 hours.
     */
    async intakeProcessed(controlCode: string): Promise<SignalResult> {
        assertSafeControlCode(controlCode);
        const fileName = `${controlCode}.xlsx`;

        const rows = await this.dbConnection.query<{ status: string | null; updated_at: string | null }>(
            `SELECT TOP 1 [status], CONVERT(varchar(19), [updated_date], 120) AS updated_at
             FROM [dbo].[de_op_file_tracker]
             WHERE [file_name] = '${fileName}'
             ORDER BY [id] DESC`,
            `de_op_file_tracker row for "${fileName}"`
        );
        const row = rows[0];
        if (!row) return { state: 'NOT_FOUND', detail: `no de_op_file_tracker row for ${fileName}` };

        const status = String(row.status ?? '').trim();
        const detail = `de_op_file_tracker: ${fileName} status ${status || '(blank)'}${row.updated_at ? ` at ${row.updated_at}` : ''}`;
        return status.toUpperCase() === 'DONE' ? { state: 'FOUND', value: status, detail } : { state: 'NOT_FOUND', detail };
    }

    /**
     * S6 (DPS/UB) — Payment Journal processed: DE loaded a de_payment_journal
     * row whose [Reference Control No.] is the code. Columns confirmed against
     * the table: [Control Code] there is NULL, and the names carry spaces and
     * dots, which column discovery would never match — so no discovery here.
     * Value = the row's Document No.; the newest load wins.
     */
    async paymentJournalProcessed(controlCode: string): Promise<SignalResult> {
        assertSafeControlCode(controlCode);

        const rows = await this.dbConnection.query<{ document_no: string | null; file_name: string | null; load_date: string | null; status: string | null }>(
            `SELECT TOP 1 [Document No.] AS document_no, [Filename] AS file_name,
                    CONVERT(varchar(10), [Load_Date], 120) AS load_date, [Status] AS status
             FROM [dbo].[de_payment_journal]
             WHERE [Reference Control No.] = '${controlCode}'
             ORDER BY [Load_Date] DESC`,
            `de_payment_journal row for Reference Control No. "${controlCode}"`
        );
        const row = rows[0];
        if (!row) return { state: 'NOT_FOUND', detail: `no de_payment_journal row where [Reference Control No.] = ${controlCode}` };

        const documentNo = String(row.document_no ?? '').trim() || undefined;
        return {
            state: 'FOUND',
            value: documentNo,
            detail: `de_payment_journal: ${row.file_name ?? '(no filename)'}, Document No. ${documentNo ?? '(blank)'}, status ${row.status ?? '(blank)'}, loaded ${row.load_date ?? '(no date)'}`,
        };
    }

    /**
     * S7 (DPS/UB) — the EP Number: transaction_no in de_dps_input /
     * de_unionbank_input, the same lookup generate-return-file.ts's
     * fetchTransactionNo() uses. A row with a blank transaction_no is not
     * the signal yet.
     */
    async epNumber(channel: Extract<PaymentChannel, 'DPS' | 'UB'>, controlCode: string): Promise<SignalResult> {
        assertSafeControlCode(controlCode);
        const table = channel === 'DPS' ? 'de_dps_input' : 'de_unionbank_input';
        const row = await this.firstRowWhere(
            table,
            `control_no = '${controlCode}' AND transaction_no IS NOT NULL AND transaction_no <> ''`,
            `${table} EP Number for control code "${controlCode}"`
        );
        if (!row) return { state: 'NOT_FOUND', detail: `no ${table} row with a transaction_no for control_no = ${controlCode}` };
        return { state: 'FOUND', value: String(row['transaction_no']).trim(), detail: `${table}.transaction_no` };
    }

    /**
     * S6/S7 (COMCHECK) — Disbursement File processed: DE loaded a
     * de_nav_pay_ref row whose [FileName] is the file S5 uploaded (the
     * column the team checks by hand). Falls back to [ctlno] only for a row
     * with no recorded file name. Columns confirmed against the table, so no
     * discovery here. A row for this very code is preferred when the file
     * holds several. Value = the row's check_no; the newest load wins.
     */
    async navPayRef(controlCode: string, disbursementFileName: string | undefined): Promise<SignalResult> {
        assertSafeControlCode(controlCode);
        if (disbursementFileName) assertSafeFileName(disbursementFileName);

        const where = disbursementFileName ? `[FileName] = '${disbursementFileName}'` : `[ctlno] = '${controlCode}'`;
        const rows = await this.dbConnection.query<{ ctlno: string | null; check_no: string | null; file_name: string | null; load_date: string | null }>(
            `SELECT TOP 1 [ctlno] AS ctlno, [check_no] AS check_no, [FileName] AS file_name,
                    CONVERT(varchar(10), [LOAD_DT], 120) AS load_date
             FROM [dbo].[de_nav_pay_ref]
             WHERE ${where}
             ORDER BY CASE WHEN [ctlno] = '${controlCode}' THEN 0 ELSE 1 END, [LOAD_DT] DESC`,
            `de_nav_pay_ref row where ${where}`
        );
        const row = rows[0];
        if (!row) return { state: 'NOT_FOUND', detail: `no de_nav_pay_ref row where ${where}` };

        const checkNo = String(row.check_no ?? '').trim() || undefined;
        return {
            state: 'FOUND',
            value: checkNo,
            detail: `de_nav_pay_ref: ${row.file_name ?? '(no filename)'}, ctlno ${row.ctlno ?? '(blank)'}, check_no ${checkNo ?? '(blank)'}, loaded ${row.load_date ?? '(no date)'}`,
        };
    }

    /**
     * S9 — Transmittal output. Keyed by control code if the table has such a
     * column; otherwise by a filename column matched against the uploaded
     * settlement file ("filename column TBC" in the swimlane).
     */
    async transmittal(controlCode: string, settlementFileName: string | undefined): Promise<SignalResult> {
        const table = 'de_transmittal_details';
        const byCode = await this.byControlCode(table, controlCode);
        if (byCode.state !== 'UNRESOLVED' || !settlementFileName) return byCode;

        assertSafeFileName(settlementFileName);
        const fileColumn = await this.findColumn(table, [/^file_?name$/i, /file_?name/i]);
        if ('unresolved' in fileColumn) return { state: 'UNRESOLVED', detail: `${byCode.detail}; ${fileColumn.unresolved}` };

        const stem = settlementFileName.replace(/\.[^.]+$/, '');
        const row = await this.firstRowWhere(table, `${quoteIdentifier(fileColumn.column)} LIKE '%${stem}%'`, `${table} row for file "${stem}"`);
        return row
            ? { state: 'FOUND', value: undefined, detail: `${table} row found by ${fileColumn.column}` }
            : { state: 'NOT_FOUND', detail: `no ${table} row where ${fileColumn.column} contains ${stem}` };
    }

    /** S9 — F2307 generation row; value = f2307_dir (the testBlob path DE wrote / read). */
    async f2307Generation(controlCode: string): Promise<SignalResult> {
        const table = 'de_f2307_pdf_generation';
        const byCode = await this.byControlCode(table, controlCode, [/^f2307_dir$/i]);
        if (byCode.state !== 'UNRESOLVED') return byCode;

        // No control-code column: fall back to f2307_dir naming the file
        // (F2307_<ControlCode>.pdf, the name generate-f2307.ts writes).
        const columns = await this.columnsOf(table);
        if (!columns.some((c) => /^f2307_dir$/i.test(c))) return byCode;
        assertSafeControlCode(controlCode);
        const row = await this.firstRowWhere(table, `f2307_dir LIKE '%${controlCode}%'`, `${table} row whose f2307_dir names "${controlCode}"`);
        return row
            ? { state: 'FOUND', value: String(row['f2307_dir'] ?? '').trim() || undefined, detail: `${table} row found by f2307_dir` }
            : { state: 'NOT_FOUND', detail: `no ${table} row whose f2307_dir contains ${controlCode}` };
    }
}
