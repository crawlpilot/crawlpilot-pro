import type { Table } from '@/shared/types/database';
import { db } from '@/shared/db';
import { csvText } from '@/shared/utils/csv';
import { exportData } from '../components/ui/data-table/pipeline';

/** Saves text as a file; `stamp` adds the date and time before the extension (data_2026-10-17T12-00-00.csv). */
/** Saves a Blob (a zip, an image) under `fileName`. */
export function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(content: string, fileName: string, type: string, stamp = false) {
    let name = fileName;
    if (stamp) {
        const time = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const dot = fileName.lastIndexOf('.');
        name = dot > 0 ? `${fileName.slice(0, dot)}_${time}${fileName.slice(dot)}` : `${fileName}_${time}`;
    }
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(data: unknown, fileName: string) {
    downloadText(JSON.stringify(data, null, 2), fileName, 'application/json');
}

/**
 * A saved table as a CSV file, as the data table would export it: every stored row, list columns
 * as arrays, the user's merged and typed columns.
 */
export async function downloadTableCsv(table: Table): Promise<void> {
    if (table.id === undefined) return;
    const rows = await db.tables.rowsPage(table.id, 0, Math.max(table.rowCount, 1));
    const { columns, rows: out } = exportData(table.columns, rows, {}, table.view?.merges ?? [], table.view?.typed ?? []);
    downloadText(csvText(columns, out), `${table.name || 'data'}.csv`, 'text/csv;charset=utf-8;', true);
}
