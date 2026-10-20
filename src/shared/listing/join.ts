/**
 * A list with its items' details (docs/plans/product-improvements-plan.md §5, S4 "List + details in one
 * run"): a Page Extractor run over the list's item links, its fields joined back onto the list's rows
 * by the link, so the list and what each item's page says end up in one table.
 */
import type { Column } from '../types/database';

/** Columns a details run adds to every row and that are no detail of the item. */
const RUN_COLUMNS = new Set(['source_url', 'recordId']);

/**
 * A page address as a join key: the host without `www.`, the path without a trailing slash, the query;
 * not the scheme or the `#fragment`. A list's link and the page the run read are the same page.
 */
export function urlJoinKey(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        const u = new URL(value.trim());
        if (!/^https?:$/.test(u.protocol)) return '';
        const path = u.pathname.replace(/\/+$/, '') || '/';
        return `${u.hostname.replace(/^www\./, '').toLowerCase()}${path}${u.search}`;
    } catch {
        return '';
    }
}

const isUrl = (v: unknown) => urlJoinKey(v) !== '';

/**
 * The list's column of item links: a URL column (not the run's own `source_url`) whose values are
 * addresses in most rows, nearly all different. The likeliest first: named `url` / `link`, then the
 * fullest. Null when the list has none.
 */
export function itemUrlColumn(columns: Column[], rows: Record<string, unknown>[]): string | null {
    const sample = rows.slice(0, 200);
    if (sample.length === 0) return null;
    const scored = columns
        .filter(c => !RUN_COLUMNS.has(c.id) && c.type !== 'image' && c.type !== 'image_array')
        .map(c => {
            const values = sample.map(r => r[c.id]).filter(isUrl) as string[];
            const distinct = new Set(values.map(urlJoinKey)).size;
            const named = /^(url|link|href)$|link|url/i.test(`${c.id} ${c.name}`) ? 1 : 0;
            return { id: c.id, filled: values.length / sample.length, distinct: values.length ? distinct / values.length : 0, named };
        })
        .filter(s => s.filled >= 0.8 && s.distinct >= 0.8);
    scored.sort((a, b) => b.named - a.named || b.filled - a.filled);
    return scored[0]?.id ?? null;
}

/** The addresses a details run opens: the item links, each once, in the list's order. */
export function itemUrls(rows: Record<string, unknown>[], urlColumn: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
        const v = r[urlColumn];
        const key = urlJoinKey(v);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push((v as string).trim());
    }
    return out;
}

export interface JoinResult {
    /** The list's columns, then the detail columns (renamed where the list has the same name or id). */
    columns: Column[];
    /** For each list row with a detail page read: the detail values to add (by the new column ids). */
    updates: { rowId: number; patch: Record<string, unknown> }[];
    matched: number;
    /** List rows with a link whose page gave no row (failed, blocked, not reached). */
    unmatched: number;
}

/**
 * The detail rows joined onto the list rows by link. A page that gave several rows (a table on it)
 * gives its first. Detail columns whose name or id the list already has get " (page)" / `_page`.
 */
export function joinDetails(
    listColumns: Column[],
    listRows: { id?: number; data: Record<string, unknown> }[],
    urlColumn: string,
    detailColumns: Column[],
    detailRows: { data: Record<string, unknown> }[],
): JoinResult {
    const ids = new Set(listColumns.map(c => c.id));
    const names = new Set(listColumns.map(c => c.name.toLowerCase()));
    const added: { from: string; column: Column }[] = [];
    for (const c of detailColumns) {
        if (RUN_COLUMNS.has(c.id)) continue;
        let id = c.id;
        while (ids.has(id)) id = `${id}_page`;
        let name = c.name;
        if (names.has(name.toLowerCase())) name = `${name} (page)`;
        ids.add(id);
        names.add(name.toLowerCase());
        added.push({ from: c.id, column: { ...c, id, name } });
    }

    const byUrl = new Map<string, Record<string, unknown>>();
    for (const r of detailRows) {
        const key = urlJoinKey(r.data.source_url);
        if (key && !byUrl.has(key)) byUrl.set(key, r.data);
    }

    const updates: JoinResult['updates'] = [];
    let unmatched = 0;
    for (const row of listRows) {
        const key = urlJoinKey(row.data[urlColumn]);
        if (!key || row.id === undefined) continue;
        const detail = byUrl.get(key);
        if (!detail) { unmatched++; continue; }
        const patch: Record<string, unknown> = {};
        for (const { from, column } of added) if (detail[from] !== undefined && detail[from] !== null && detail[from] !== '') patch[column.id] = detail[from];
        if (Object.keys(patch).length) updates.push({ rowId: row.id, patch });
    }
    return { columns: [...listColumns, ...added.map(a => a.column)], updates, matched: updates.length, unmatched };
}
