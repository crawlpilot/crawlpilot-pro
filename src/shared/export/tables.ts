/** A page table (`content/services/tables/findTables.ts`) as text to paste, a CSV, or a saved table. */
import type { Column, ExtractionResult } from '../types/database';
import type { PageTable } from '../../content/services/tables/findTables';
import { csvText } from '../utils/csv';

/** Tab-separated: pastes into Sheets and Excel as cells. Tabs and line breaks in a cell become spaces. */
export function tableTsv(t: Pick<PageTable, 'columns' | 'rows'>): string {
    const cell = (v: string) => v.replace(/[\t\r\n]+/g, ' ');
    return [t.columns, ...t.rows].map(r => r.map(cell).join('\t')).join('\n');
}

const columnType = (name: string): Column['type'] => (name.endsWith(' (link)') ? 'url' : name.endsWith(' (image)') ? 'image' : 'text');

export function tableColumns(t: Pick<PageTable, 'columns'>): Column[] {
    return t.columns.map((name, order) => ({ id: name, name, type: columnType(name), order }));
}

const records = (t: Pick<PageTable, 'columns' | 'rows'>) => t.rows.map(r => Object.fromEntries(t.columns.map((c, i) => [c, r[i] ?? ''])));

export function tableCsv(t: Pick<PageTable, 'columns' | 'rows'>): string {
    return csvText(tableColumns(t), records(t));
}

export function tableResult(t: Pick<PageTable, 'columns' | 'rows'>, url: string): ExtractionResult {
    const items = records(t).map(r => ({ ...r, source_url: url }));
    return { type: 'table', columns: tableColumns(t), items, source_url: url, count: items.length, timestamp: new Date().toISOString() };
}
