/**
 * The data table's view of a table, as pure steps: explode JSON list/table columns into rows,
 * add merged and typed columns, drop empty rows, choose and order the visible columns, and build
 * the export.
 */
import type { Column, Row as TableRow, TypedColumnDef } from '@/shared/types/database';
import { applyChain, FieldType } from '@/shared/transforms/chain';
import { hashString } from '@/shared/utils/hash';

export type MergeDefinition = { id: string; name: string; sources: string[]; separator: string };
export type Row = Record<string, any>;

export interface ColumnFilters {
    hideRepeatingData: boolean;
    removeEmptyColumns: boolean;
    hideMostlyEmptyColumns: boolean;
    removeDuplicateColumns: boolean;
}

const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';

function parseJsonForExplosion(val: unknown): any[][] {
    if (typeof val !== 'string') return [];
    try {
        const parsed = JSON.parse(val);
        if (!Array.isArray(parsed) || parsed.length === 0) return [];
        if (Array.isArray(parsed[0])) return parsed as any[][];
        return parsed.map((v: any) => [v]);
    } catch { return []; }
}

/** Grid column type for a typed column's output. */
function gridTypeOf(t: FieldType): Column['type'] {
    if (t === 'date') return 'date';
    if (t === 'url') return 'url';
    if (t === 'text' || t === 'boolean') return 'text';
    return 'number';
}

/** Adds typed-column values (and a currency column for money) to a flat row. */
export function applyTypedCols(row: Row, defs: TypedColumnDef[]) {
    for (const d of defs) {
        const r = applyChain(row[d.source], d.type, d.ops, { baseUrl: typeof row.source_url === 'string' ? row.source_url : undefined, dayFirst: d.dayFirst });
        row[d.id] = r.value;
        if (d.type === 'money') row[`${d.id}__currency`] = r.currency ?? '';
    }
}

export function typedColumnsOf(defs: TypedColumnDef[]): Column[] {
    const out: Column[] = [];
    for (const d of defs) {
        out.push({ id: d.id, name: d.name, type: gridTypeOf(d.type) });
        if (d.type === 'money') out.push({ id: `${d.id}__currency`, name: `${d.name} currency`, type: 'text' });
    }
    return out;
}

/**
 * A `json` column (a Page Extractor list or table) becomes one column per position and one row per
 * item; the page's other values stay on the first of its rows. `tabledata` columns are dropped.
 */
export function explodeJsonColumns(rows: TableRow[], columns: Column[]): { displayRows: TableRow[]; displayColumns: Column[] } {
    const jsonCols = columns.filter(c => c.type === 'json' && !c.hidden);
    if (jsonCols.length === 0) return { displayRows: rows, displayColumns: columns.filter(c => c.type !== 'tabledata') };

    const width = new Map<string, number>();
    jsonCols.forEach(col => {
        let max = 0;
        rows.forEach(row => {
            const subs = parseJsonForExplosion(row.data[col.id]);
            subs.forEach(sub => { max = Math.max(max, sub.length); });
            if (subs.length > 0) max = Math.max(max, 1);
        });
        width.set(col.id, max || 1);
    });

    const posCols: Column[] = jsonCols.flatMap(col => {
        const count = width.get(col.id) ?? 1;
        return Array.from({ length: count }, (_, p) => ({
            id: `${col.id}__pos${p}`,
            name: count === 1 ? col.name : `${col.name} ${p + 1}`,
            type: 'text' as const,
            elementId: col.elementId,
            elementName: col.elementName,
            group: col.group,
        }));
    });

    const skip = new Set([...jsonCols.map(c => c.id), ...columns.filter(c => c.type === 'tabledata').map(c => c.id)]);
    const displayRows: TableRow[] = [];
    rows.forEach(row => {
        const subs = new Map(jsonCols.map(col => [col.id, parseJsonForExplosion(row.data[col.id])]));
        const count = Math.max(1, ...Array.from(subs.values()).map(a => a.length));
        for (let i = 0; i < count; i++) {
            const data: Row = {};
            Object.keys(row.data).forEach(key => {
                if (!skip.has(key)) data[key] = i === 0 ? row.data[key] : null;
            });
            jsonCols.forEach(col => {
                const sub = subs.get(col.id)?.[i] ?? [];
                for (let p = 0; p < (width.get(col.id) ?? 1); p++) data[`${col.id}__pos${p}`] = sub[p] ?? null;
            });
            displayRows.push({ ...row, id: row.id !== undefined ? row.id * 100000 + i : undefined, data });
        }
    });

    return {
        displayRows,
        displayColumns: [...columns.filter(c => c.type !== 'json' && c.type !== 'tabledata'), ...posCols],
    };
}

/** Flat rows with merged and typed columns added; merge sources and deleted columns hidden. */
export function withDerivedColumns(rows: TableRow[], columns: Column[], merged: MergeDefinition[], typed: TypedColumnDef[], deleted: Set<string>): { baseRows: Row[]; baseColumns: Column[] } {
    const baseRows = rows.map(r => {
        const row: Row = { ...r.data, id: r.id };
        merged.forEach(m => {
            row[m.id] = m.sources.map(s => row[s]).filter(v => v !== undefined && v !== null && v !== '').join(m.separator);
        });
        applyTypedCols(row, typed);
        return row;
    });
    const hidden = new Set(deleted);
    merged.forEach(m => m.sources.forEach(s => hidden.add(s)));
    const baseColumns = [
        ...columns,
        ...merged.map(m => ({ id: m.id, name: m.name, type: 'text' as const })),
        ...typedColumnsOf(typed),
    ].filter(c => !hidden.has(c.id));
    return { baseRows, baseColumns };
}

export function dropEmptyRows(rows: Row[], columns: Column[]): Row[] {
    return columns.length === 0 ? rows : rows.filter(row => columns.some(col => filled(row[col.id])));
}

/** Pinned first (record id, URL, images), then the fullest columns. */
function columnPriority(col: Column): number {
    if (col.id === 'recordId') return 0;
    if (col.id === 'url' || col.id === 'source_url') return 1;
    if (col.type === 'image_array') return 2;
    return 3;
}

/** The columns to show, by the filter toggles, in display order. No filter ever hides every column. */
export function visibleColumns(columns: Column[], rows: Row[], f: ColumnFilters): Column[] {
    let cols = [...columns];

    if (f.hideRepeatingData) {
        const varying = cols.filter(col => {
            const first = rows[0]?.[col.id];
            return !first || !rows.every(r => r[col.id] === first);
        });
        if (varying.length > 0) cols = varying;
    }
    if (f.removeEmptyColumns) cols = cols.filter(col => rows.some(r => filled(r[col.id])));
    if (f.hideMostlyEmptyColumns) {
        const threshold = rows.length * 0.2;
        const dense = cols.filter(col => rows.filter(r => r[col.id]).length >= threshold);
        if (dense.length > 0) cols = dense;
    }
    if (f.removeDuplicateColumns) {
        // The first 50 rows decide: hashing every row of a large table was the hottest step here.
        const sample = rows.slice(0, 50);
        const seen = new Set<number>();
        cols = cols.filter(col => {
            const hash = hashString(sample.map(r => r[col.id]).join('||'));
            if (seen.has(hash)) return false;
            seen.add(hash);
            return true;
        });
    }

    const density = new Map(cols.map(col => [col.id, rows.reduce((n, r) => n + (filled(r[col.id]) ? 1 : 0), 0)]));
    return cols.sort((a, b) => columnPriority(a) - columnPriority(b) || (density.get(b.id) ?? 0) - (density.get(a.id) ?? 0));
}

/** The table as exported: the stored (unexploded) rows, list columns as arrays, with merged and typed columns. */
export function exportData(columns: Column[], rows: TableRow[], renames: Record<string, string>, merged: MergeDefinition[], typed: TypedColumnDef[]) {
    const cols = columns.filter(c => !c.hidden && c.type !== 'tabledata');
    const typedCols = typedColumnsOf(typed);
    const arrayTypes = new Set<string>(['json', 'image_array', 'link_array', 'text_array']);
    return {
        columns: [
            ...cols.map(col => ({ id: col.id, name: renames[col.id] || col.name, type: col.type as string })),
            ...merged.map(m => ({ id: m.id, name: m.name, type: 'text' })),
            ...typedCols.map(c => ({ id: c.id, name: c.name, type: c.type as string })),
        ],
        rows: rows.map(r => {
            const out: Row = {};
            cols.forEach(col => {
                let val = r.data[col.id];
                if (typeof val === 'string' && arrayTypes.has(col.type)) {
                    try { val = JSON.parse(val); } catch { /* keep the text */ }
                }
                out[col.id] = val;
            });
            merged.forEach(m => {
                out[m.id] = m.sources.map(src => r.data[src]).filter(v => v !== undefined && v !== null && v !== '').join(m.separator);
            });
            const typedRow: Row = { ...r.data };
            applyTypedCols(typedRow, typed);
            typedCols.forEach(c => { out[c.id] = typedRow[c.id]; });
            return out;
        }),
    };
}
