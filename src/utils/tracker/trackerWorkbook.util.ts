// ─────────────────────────────────────────────
//  trackerWorkbook.util.ts
//  Reads the Control Code Tracker .xlsx into plain
//  data, and builds a fully formatted workbook back
//  from that data. Every write rebuilds the workbook
//  from scratch — formatting (bands, dropdowns,
//  status colors, outline groups) lives here in code,
//  not in the file, so it can't drift or get lost in
//  an ExcelJS round-trip. Only cell VALUES are read
//  back; hand-applied formatting is not preserved.
// ─────────────────────────────────────────────

import ExcelJS from 'exceljs';
import { access } from 'fs/promises';
import {
    BLOB_FOLDERS,
    CLAIM_ROW_HEADERS,
    CONFIG_HEADERS,
    DEFAULT_WAIT_WINDOWS,
    EVENT_LOG_HEADERS,
    STAGES,
    STAGE_DEFS,
    STAGE_STATUSES,
    STATUS_FILL,
    STATUS_MEANINGS,
    TRACKER_COLUMNS,
    writerFor,
    type ColumnGroup,
    type StageStatus,
    type TrackerColumnKey,
    type WaitStage,
} from '../../constants/tracker.config.ts';
import { formatTimestamp, parseTimestamp, type CellValue, type TrackerRow, type WaitConfig } from './trackerRules.util.ts';

export type ClaimRow = {
    controlCode: string;
    rowNumber: number;
    transactionId: string;
    actionMemo: string;
};

export type TrackerEvent = {
    timestamp: Date;
    runId: string;
    controlCode: string;
    stage: string;
    from: string;
    to: string;
    actor: string;
    elapsedMinutes: number | undefined;
    detail: string;
};

export type TrackerData = {
    rows: TrackerRow[];
    claimRows: ClaimRow[];
    events: TrackerEvent[];
    config: WaitConfig;
};

const SHEET = {
    tracker: 'Tracker',
    claimRows: 'Claim Rows',
    events: 'Event Log',
    config: 'Config',
    legend: 'Legend',
} as const;

// Tracker sheet: row 1 = stage bands, row 2 = headers, data from row 3.
const TRACKER_HEADER_ROW = 2;
const TRACKER_FIRST_DATA_ROW = 3;

export function defaultConfig(): WaitConfig {
    return structuredClone(DEFAULT_WAIT_WINDOWS);
}

export function emptyTrackerData(): TrackerData {
    return { rows: [], claimRows: [], events: [], config: defaultConfig() };
}

// ─── Reading ──────────────────────────────

/**
 * Flattens whatever ExcelJS hands back — a cell someone edited in Excel can
 * come back as rich text, a formula result or a hyperlink object rather
 * than a plain value.
 */
function plainValue(value: ExcelJS.CellValue): CellValue {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) return value;
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'object') {
        if ('richText' in value) return value.richText.map((part) => part.text).join('');
        if ('result' in value) return plainValue(value.result as ExcelJS.CellValue);
        if ('text' in value) return String(value.text);
    }
    return String(value);
}

function asText(value: CellValue): string {
    if (value === undefined) return '';
    if (value instanceof Date) return formatTimestamp(parseTimestamp(value)!);
    return String(value).trim();
}

function asNumber(value: CellValue): number | undefined {
    if (value === undefined || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function headerIndex(sheet: ExcelJS.Worksheet, headerRow: number): Map<string, number> {
    const index = new Map<string, number>();
    sheet.getRow(headerRow).eachCell((cell, col) => {
        const text = asText(plainValue(cell.value));
        if (text) index.set(text, col);
    });
    return index;
}

function readTrackerSheet(sheet: ExcelJS.Worksheet): TrackerRow[] {
    // Columns are looked up by header text, not position, so reordering
    // TRACKER_COLUMNS doesn't scramble an existing file.
    const index = headerIndex(sheet, TRACKER_HEADER_ROW);
    const rows: TrackerRow[] = [];

    for (let r = TRACKER_FIRST_DATA_ROW; r <= sheet.rowCount; r++) {
        const excelRow = sheet.getRow(r);
        const row: TrackerRow = {};
        for (const column of TRACKER_COLUMNS) {
            const col = index.get(column.header);
            if (!col) continue;
            const value = plainValue(excelRow.getCell(col).value);
            const kind = 'kind' in column ? column.kind : undefined;
            if (kind === 'number') row[column.key] = asNumber(value);
            else if (kind === 'timestamp') row[column.key] = asText(value) || undefined;
            else row[column.key] = asText(value) || undefined;
        }
        if (row.controlCode) rows.push(row);
    }
    return rows;
}

function readSimpleSheet(sheet: ExcelJS.Worksheet, headers: readonly string[]): Record<string, CellValue>[] {
    const index = headerIndex(sheet, 1);
    const records: Record<string, CellValue>[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
        const excelRow = sheet.getRow(r);
        const record: Record<string, CellValue> = {};
        let empty = true;
        for (const header of headers) {
            const col = index.get(header);
            const value = col ? plainValue(excelRow.getCell(col).value) : undefined;
            if (value !== undefined && value !== '') empty = false;
            record[header] = value;
        }
        if (!empty) records.push(record);
    }
    return records;
}

function readConfigSheet(sheet: ExcelJS.Worksheet | undefined): WaitConfig {
    const config = defaultConfig();
    if (!sheet) return config;

    for (const record of readSimpleSheet(sheet, CONFIG_HEADERS)) {
        const stage = asText(record['Stage']) as WaitStage;
        if (!(stage in config)) continue;
        // A blank or non-numeric cell keeps the default rather than becoming
        // a 0-minute window, which would time every code out on first check.
        const minWait = asNumber(record['Min Wait (min)']);
        const cap = asNumber(record['Cap (min)']);
        if (minWait !== undefined && minWait >= 0) config[stage].minWaitMinutes = minWait;
        if (cap !== undefined && cap > 0) config[stage].capMinutes = cap;
        const signal = asText(record['Signal']);
        if (signal) config[stage].signal = signal;
    }
    return config;
}

export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function readTrackerFile(filePath: string): Promise<TrackerData> {
    if (!(await fileExists(filePath))) return emptyTrackerData();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const trackerSheet = workbook.getWorksheet(SHEET.tracker);
    const claimSheet = workbook.getWorksheet(SHEET.claimRows);
    const eventSheet = workbook.getWorksheet(SHEET.events);

    return {
        rows: trackerSheet ? readTrackerSheet(trackerSheet) : [],
        claimRows: claimSheet
            ? readSimpleSheet(claimSheet, CLAIM_ROW_HEADERS).map((r) => ({
                controlCode: asText(r['Control Code']),
                rowNumber: asNumber(r['Row #']) ?? 0,
                transactionId: asText(r['Consultation/Transaction ID']),
                actionMemo: asText(r['Action Memo']),
            }))
            : [],
        events: eventSheet
            ? readSimpleSheet(eventSheet, EVENT_LOG_HEADERS).map((r) => ({
                timestamp: parseTimestamp(r['Timestamp']) ?? new Date(0),
                runId: asText(r['Run ID']),
                controlCode: asText(r['Control Code']),
                stage: asText(r['Stage']),
                from: asText(r['From']),
                to: asText(r['To']),
                actor: asText(r['Actor']),
                elapsedMinutes: asNumber(r['Elapsed (min)']),
                detail: asText(r['Detail']),
            }))
            : [],
        config: readConfigSheet(workbook.getWorksheet(SHEET.config)),
    };
}

// ─── Building ──────────────────────────────

const WHITE_BOLD: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
const HEADER_FILL = 'FFE7ECF3';
const THIN_BORDER: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
};

const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const GROUP_BAND: Record<'IDENTITY' | 'CONTROL', { label: string; color: string }> = {
    IDENTITY: { label: 'Identity', color: 'FF44546A' },
    CONTROL: { label: 'Control — what to do next', color: 'FF262626' },
};

function groupBand(group: ColumnGroup): { label: string; color: string } {
    return group === 'IDENTITY' || group === 'CONTROL' ? GROUP_BAND[group] : { label: STAGE_DEFS[group].label, color: STAGE_DEFS[group].color };
}

// Inline list (79 chars) — well under Excel's 255-char limit for one.
const STATUS_LIST_FORMULA = `"${STAGE_STATUSES.join(',')}"`;

function styleHeaderRow(row: ExcelJS.Row): void {
    row.font = { bold: true };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.eachCell((cell) => {
        cell.fill = solid(HEADER_FILL);
        cell.border = THIN_BORDER;
    });
}

function cellValueFor(value: CellValue): ExcelJS.CellValue {
    return value === undefined ? null : value;
}

function buildTrackerSheet(workbook: ExcelJS.Workbook, rows: TrackerRow[]): void {
    const sheet = workbook.addWorksheet(SHEET.tracker, {
        views: [{ state: 'frozen', xSplit: 1, ySplit: TRACKER_HEADER_ROW }],
        properties: { outlineProperties: { summaryBelow: false, summaryRight: false } },
    });

    // Row 1: one merged band per group (Identity, Control, each stage).
    let start = 1;
    for (let col = 1; col <= TRACKER_COLUMNS.length; col++) {
        const group = TRACKER_COLUMNS[col - 1]!.group;
        const nextGroup = TRACKER_COLUMNS[col]?.group;
        if (nextGroup === group) continue;

        const band = groupBand(group);
        if (col > start) sheet.mergeCells(1, start, 1, col);
        const cell = sheet.getCell(1, start);
        cell.value = band.label;
        cell.font = WHITE_BOLD;
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        for (let c = start; c <= col; c++) sheet.getCell(1, c).fill = solid(band.color);
        start = col + 1;
    }
    sheet.getRow(1).height = 20;

    // Row 2: headers. Within a stage, everything after Status + timestamp is
    // outline level 1, so collapsing a stage still shows how far it got.
    const headerRow = sheet.getRow(TRACKER_HEADER_ROW);
    TRACKER_COLUMNS.forEach((column, i) => {
        headerRow.getCell(i + 1).value = column.header;
        const sheetColumn = sheet.getColumn(i + 1);
        sheetColumn.width = column.width;
        const kind = 'kind' in column ? column.kind : undefined;
        const isStageDetail = column.group !== 'IDENTITY' && column.group !== 'CONTROL' && kind !== 'status' && kind !== 'timestamp';
        if (isStageDetail) sheetColumn.outlineLevel = 1;
    });
    headerRow.height = 32;
    styleHeaderRow(headerRow);

    rows.forEach((row, r) => {
        const excelRow = sheet.getRow(TRACKER_FIRST_DATA_ROW + r);
        TRACKER_COLUMNS.forEach((column, i) => {
            const cell = excelRow.getCell(i + 1);
            const value = row[column.key as TrackerColumnKey];
            cell.value = cellValueFor(value);
            cell.border = THIN_BORDER;

            if (('kind' in column ? column.kind : undefined) === 'status') {
                const fill = STATUS_FILL[String(value ?? '') as StageStatus];
                if (fill) cell.fill = solid(fill);
                // Dropdown on stage statuses only — Current Status is derived.
                if (column.key !== 'currentStatus') {
                    cell.dataValidation = {
                        type: 'list',
                        allowBlank: true,
                        formulae: [STATUS_LIST_FORMULA],
                        showErrorMessage: true,
                        errorTitle: 'Unknown status',
                        error: 'Pick one of the statuses listed on the Legend sheet.',
                    };
                }
            }
        });
    });

    sheet.autoFilter = {
        from: { row: TRACKER_HEADER_ROW, column: 1 },
        to: { row: TRACKER_HEADER_ROW, column: TRACKER_COLUMNS.length },
    };
}

function buildSimpleSheet(
    workbook: ExcelJS.Workbook,
    name: string,
    headers: readonly string[],
    widths: number[],
    records: ExcelJS.CellValue[][]
): ExcelJS.Worksheet {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = headers.map((header, i) => ({ header, width: widths[i] ?? 16 }));
    styleHeaderRow(sheet.getRow(1));
    for (const record of records) sheet.addRow(record);
    return sheet;
}

function buildLegendSheet(workbook: ExcelJS.Workbook): void {
    const sheet = workbook.addWorksheet(SHEET.legend);
    sheet.columns = [{ width: 30 }, { width: 70 }, { width: 40 }];

    const section = (title: string, headers: string[]) => {
        if (sheet.rowCount > 0) sheet.addRow([]);
        const titleRow = sheet.addRow([title]);
        titleRow.font = { bold: true, size: 12 };
        styleHeaderRow(sheet.addRow(headers));
    };

    section('How to use', ['Rule', 'Detail']);
    sheet.addRow(['Close this file before running specs', 'Specs rewrite the whole workbook. Excel locks an open file on Windows, and edits saved while a spec is running can be lost.']);
    sheet.addRow(['Re-run freely', 'Every spec only processes codes that are eligible right now, so re-running one (or the whole api project) never repeats a passed step.']);
    sheet.addRow(['Waits never retry themselves', 'A TIMED_OUT wait stops only that code. Investigate, then confirm by hand: set the stage to PASSED with its timestamp and a Remark.']);
    sheet.addRow(['Timestamps', 'Local time, as text: YYYY-MM-DD HH:MM:SS.']);

    section('Statuses', ['Status', 'Meaning']);
    for (const status of STAGE_STATUSES) {
        const row = sheet.addRow([status, STATUS_MEANINGS[status]]);
        const fill = STATUS_FILL[status];
        if (fill) row.getCell(1).fill = solid(fill);
    }

    section('Stages', ['Stage', 'Advanced by', 'Kind']);
    for (const stage of STAGES) {
        sheet.addRow([STAGE_DEFS[stage].label, writerFor(stage, undefined), STAGE_DEFS[stage].kind]);
    }

    section('Upload locations', ['Upload', 'Blob folder']);
    for (const [label, folder] of BLOB_FOLDERS) sheet.addRow([label, folder]);

    sheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
}

export function buildTrackerWorkbook(data: TrackerData): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'claims-qa-automation';

    buildTrackerSheet(workbook, data.rows);

    buildSimpleSheet(workbook, SHEET.claimRows, CLAIM_ROW_HEADERS, [22, 7, 28, 12],
        data.claimRows.map((r) => [r.controlCode, r.rowNumber, r.transactionId, r.actionMemo]));

    buildSimpleSheet(workbook, SHEET.events, EVENT_LOG_HEADERS, [20, 18, 22, 24, 13, 13, 30, 9, 80],
        data.events.map((e) => [formatTimestamp(e.timestamp), e.runId, e.controlCode, e.stage, e.from, e.to, e.actor, e.elapsedMinutes ?? null, e.detail]));

    const configSheet = buildSimpleSheet(workbook, SHEET.config, CONFIG_HEADERS, [24, 15, 11, 80],
        (Object.keys(data.config) as WaitStage[]).map((stage) => {
            const window = data.config[stage];
            return [stage, window.minWaitMinutes, window.capMinutes, window.signal];
        }));
    configSheet.addRow([]);
    configSheet.addRow(['Edit Min Wait / Cap here. "Next Check At" = window start + Min Wait; "Wait Deadline" = window start + Cap.']);

    buildLegendSheet(workbook);
    return workbook;
}
