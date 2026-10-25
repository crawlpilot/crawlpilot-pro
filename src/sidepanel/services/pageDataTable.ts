/**
 * One item from the page's own data (JSON-LD, app state) read and saved as a table: no model and no
 * selectors, the same reading a run does (`PAGE_JSON_READ`). Home's product suggestion and the
 * Toolkit's "Data on this page" both keep a page's details this way.
 */
import { sendToPage } from '../../shared/messages';
import { db } from '../../shared/db';
import { bindingsFor, type JsonCandidate, type PickedAttribute } from '../../shared/pageJson/scan';

/** A read value as one cell: an object of name → value pairs as "Fit: Relaxed, Length: Regular". */
export function cell(v: string | string[] | null | undefined): string {
    if (Array.isArray(v)) return v.join(', ');
    if (v && v.startsWith('{')) { try { return Object.entries(JSON.parse(v)).map(([k, x]) => `${k}: ${x}`).join(', '); } catch { /* not an object */ } }
    return v ?? '';
}

/** The attributes worth taking by default: the suggested ones, else the first few. */
export function defaultPicks(item: JsonCandidate): PickedAttribute[] {
    const suggested = item.attributes.filter(a => a.suggested);
    return (suggested.length ? suggested : item.attributes.slice(0, 12)).map(a => ({ key: a.key, name: a.name, many: a.many }));
}

/** Saves rows as a table of this page (its columns in pick order) and returns its id. */
export function saveRowsTable(rows: Record<string, string>[], picks: PickedAttribute[], url: string, name: string): Promise<number> {
    return db.tables.save({
        type: 'list',
        items: rows.map(r => ({ ...r, source_url: url })),
        columns: picks.map((p, i) => ({ id: p.name, name: p.name, type: 'text' as const, order: i })),
        source_url: url,
        count: rows.length,
        timestamp: new Date().toISOString(),
    }, { name });
}

/** Reads the item's picked attributes on the page and saves them as a one-row table; returns its id. */
export async function saveItemTable(tab: chrome.tabs.Tab | undefined, item: JsonCandidate, picks: PickedAttribute[], url: string, host: string): Promise<number> {
    const { values } = await sendToPage(tab, 'PAGE_JSON_READ', { bindings: bindingsFor(item, picks).map(e => e.data) });
    const row = Object.fromEntries(picks.map((p, i) => [p.name, cell(values[i] as string | string[] | null)]));
    return saveRowsTable([row], picks, url, `${item.title} · ${host}`);
}
