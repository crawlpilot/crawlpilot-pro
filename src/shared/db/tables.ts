/** Datasets (`tables`) and their rows (`rows`). */
import type { Column, ExtractionResult, Row, Table } from '../types/database';
import { hashString } from '../utils/hash';
import { done, req, transaction, walk } from './idb';
import { STORES } from './schema';
import { joinDetails } from '../listing/join';

export interface SaveOptions {
    name?: string;
    jobId?: number;
    /** Write into this table (a preview, or this job's own table) instead of creating one. */
    tableId?: number;
    preview?: boolean;
    /** Replace the table's rows instead of appending. */
    replace?: boolean;
}

/** Fields that differ for the same item read on two pages (where it was read, its position, how it was read). */
const NOT_IDENTITY = new Set(['source_url', 'recordId', '_sources']);

function sortKeys(value: any): any {
    if (typeof value !== 'object' || value === null) return value;
    if (Array.isArray(value)) return value.map(sortKeys);
    return Object.keys(value).sort().reduce((out: any, k) => { out[k] = sortKeys(value[k]); return out; }, {});
}

/** A row's identity in its table: its data without where it was read. */
export function rowKey(data: Record<string, any>): string {
    const identity = Object.fromEntries(Object.entries(data).filter(([k]) => !NOT_IDENTITY.has(k)));
    return hashString(JSON.stringify(sortKeys(identity))).toString();
}

async function create(table: Omit<Table, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
    const now = Date.now();
    const tx = await transaction(STORES.tables, 'readwrite');
    return await req(tx.objectStore(STORES.tables).add({ ...table, createdAt: now, updatedAt: now })) as number;
}

async function get(id: number): Promise<Table | null> {
    const tx = await transaction(STORES.tables);
    return (await req(tx.objectStore(STORES.tables).get(id))) ?? null;
}

/** Newest first. */
async function list(limit = 50): Promise<Table[]> {
    const tx = await transaction(STORES.tables);
    const out: Table[] = [];
    await walk<Table>(tx.objectStore(STORES.tables).index('createdAt').openCursor(null, 'prev'), t => {
        out.push(t);
        return out.length < limit;
    });
    return out;
}

/** Updates fields; `view` is merged key by key, everything else replaced. */
async function update(id: number, patch: Partial<Table>): Promise<void> {
    const tx = await transaction(STORES.tables, 'readwrite');
    const store = tx.objectStore(STORES.tables);
    const current: Table | undefined = await req(store.get(id));
    if (!current) throw new Error(`Table ${id} not found`);
    store.put({ ...current, ...patch, view: { ...current.view, ...patch.view }, updatedAt: Date.now() });
    await done(tx);
}

/**
 * The table's columns, replaced as a whole: a run's columns are final, never merged with older ones.
 * The user's renames and removals stay: a run still writing into the table (a live preview) keeps them.
 */
async function setColumns(id: number, columns: Column[]): Promise<void> {
    const view = (await get(id))?.view ?? {};
    const removed = new Set(view.removed ?? []);
    await update(id, {
        columns: columns.filter(c => !removed.has(c.id)).map(c => (view.renames?.[c.id] ? { ...c, name: view.renames[c.id] } : c)),
    });
}

async function renameColumn(id: number, columnId: string, name: string): Promise<void> {
    const table = await get(id);
    if (!table) throw new Error(`Table ${id} not found`);
    await update(id, {
        columns: table.columns.map(c => (c.id === columnId ? { ...c, name } : c)),
        view: { renames: { ...table.view.renames, [columnId]: name } },
    });
}

/** Removes a column from the table, for good: a run still writing into it doesn't bring it back. */
async function removeColumn(id: number, columnId: string): Promise<void> {
    const table = await get(id);
    if (!table) throw new Error(`Table ${id} not found`);
    await update(id, {
        columns: table.columns.filter(c => c.id !== columnId),
        view: { removed: [...new Set([...(table.view.removed ?? []), columnId])] },
    });
}

async function rowCount(id: number): Promise<number> {
    const tx = await transaction(STORES.rows);
    return req(tx.objectStore(STORES.rows).index('tableId').count(IDBKeyRange.only(id)));
}

/** Rows in insertion order, `offset` skipped. */
async function rowsPage(id: number, offset: number, limit: number): Promise<Row[]> {
    const tx = await transaction(STORES.rows);
    const request = tx.objectStore(STORES.rows).index('tableId').openCursor(IDBKeyRange.only(id));
    const out: Row[] = [];
    let skipping = offset > 0;
    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) { resolve(out); return; }
            if (skipping) { skipping = false; cursor.advance(offset); return; }
            out.push(cursor.value);
            if (out.length < limit) cursor.continue(); else resolve(out);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Appends rows, skipping any the table already has (the same item, wherever it was read). Returns
 * how many were stored and records the table's row count from what is actually stored.
 */
async function appendRows(id: number, items: Record<string, any>[]): Promise<number> {
    if (items.length === 0) return 0;
    const tx = await transaction(STORES.rows, 'readwrite');
    const store = tx.objectStore(STORES.rows);
    const byKey = store.index('tableId_key');
    const now = Date.now();
    let stored = 0;
    const batch = new Set<string>();
    for (const data of items) {
        const key = rowKey(data);
        if (batch.has(key)) continue;
        batch.add(key);
        const row: Row = { tableId: id, data, key, createdAt: now };
        // Rows already in the table (an earlier page or batch) are skipped, not added and rejected.
        const seen = byKey.count([id, key]);
        seen.onsuccess = () => {
            if (seen.result > 0) return;
            store.add(row).onsuccess = () => { stored++; };
        };
    }
    await done(tx);
    await update(id, { rowCount: await rowCount(id) });
    // A dataset kept in sync with the user's Google Sheet gets its new rows there too.
    if (stored > 0) void get(id).then(t => { if (t?.view.sheet?.sync) void import('../integrations/sheetsSync').then(m => m.queueSync(id)); });
    return stored;
}

async function clearRows(id: number): Promise<void> {
    const tx = await transaction(STORES.rows, 'readwrite');
    await walk(tx.objectStore(STORES.rows).index('tableId').openCursor(IDBKeyRange.only(id)), (_, c) => { c.delete(); });
    await done(tx);
}

/** Deletes a table and its rows. */
async function remove(id: number): Promise<void> {
    const tx = await transaction([STORES.tables, STORES.rows], 'readwrite');
    tx.objectStore(STORES.tables).delete(id);
    await walk(tx.objectStore(STORES.rows).index('tableId').openCursor(IDBKeyRange.only(id)), (_, c) => { c.delete(); });
    await done(tx);
}

/** Preview tables no job owns, except `keep`: a new preview replaces the ones left from earlier picks. */
async function removeLoosePreviews(keep: number): Promise<void> {
    const tx = await transaction(STORES.tables);
    const loose: number[] = [];
    await walk<Table>(tx.objectStore(STORES.tables).openCursor(), t => {
        if (t.id !== keep && t.preview && t.jobId === undefined) loose.push(t.id!);
    });
    for (const id of loose) await remove(id);
}

/**
 * Saves an extraction: into `tableId` when it is a preview or this job's table, otherwise into a
 * new table. Rows are appended (or replace the old ones with `replace`), columns replaced.
 */
async function save(result: ExtractionResult, options: SaveOptions = {}): Promise<number> {
    const preview = options.preview ?? false;
    const baseName = options.name || 'Extraction';
    const name = preview ? `Preview: ${baseName}` : baseName;
    const source = result.type || 'list';

    let id = options.tableId;
    if (id !== undefined) {
        const existing = await get(id);
        // Gone, or another job's finished table: never overwrite it.
        if (!existing || (!existing.preview && existing.jobId !== options.jobId)) id = undefined;
    }

    if (id !== undefined) {
        if (options.replace) await clearRows(id);
        await update(id, { name, jobId: options.jobId, source, preview });
    } else {
        id = await create({
            name,
            jobId: options.jobId,
            source,
            sourceUrl: result.source_url || (typeof window !== 'undefined' ? window.location.href : 'unknown'),
            columns: [],
            rowCount: 0,
            preview,
            view: {},
        });
        if (preview && options.jobId === undefined) await removeLoosePreviews(id);
    }

    await appendRows(id, result.items ?? []);
    if (result.columns?.length) await setColumns(id, result.columns);
    return id;
}

/**
 * Changes a row's values (a cell edited in the data table). The value as read is kept in `edits` the
 * first time it changes, and dropped when the value goes back to it.
 */
async function updateRow(rowId: number, patch: Record<string, unknown>): Promise<Row> {
    const tx = await transaction(STORES.rows, 'readwrite');
    const store = tx.objectStore(STORES.rows);
    const row: Row | undefined = await req(store.get(rowId));
    if (!row) throw new Error(`Row ${rowId} not found`);
    const edits: Record<string, unknown> = { ...row.edits };
    for (const [k, v] of Object.entries(patch)) {
        if (!(k in edits)) edits[k] = row.data[k];
        if (edits[k] === v || ((edits[k] ?? '') === '' && (v ?? '') === '')) delete edits[k];
    }
    const next: Row = { ...row, data: { ...row.data, ...patch } };
    if (Object.keys(edits).length) next.edits = edits; else delete next.edits;
    store.put(next);
    await done(tx);
    return next;
}

/**
 * Joins a details run's table onto the list it ran for (`listing/join.ts`): the detail columns are
 * added to the list, and each list row gets its page's values. The details table is kept as it is.
 */
async function joinDetailsInto(listId: number, urlColumn: string, detailId: number): Promise<{ matched: number; unmatched: number }> {
    const [list, detail] = await Promise.all([get(listId), get(detailId)]);
    if (!list || !detail) throw new Error('The list or its details table is gone.');
    const [listRows, detailRows] = await Promise.all([
        rowCount(listId).then(n => rowsPage(listId, 0, Math.max(n, 1))),
        rowCount(detailId).then(n => rowsPage(detailId, 0, Math.max(n, 1))),
    ]);
    const out = joinDetails(list.columns, listRows, urlColumn, detail.columns, detailRows);
    const tx = await transaction(STORES.rows, 'readwrite');
    const store = tx.objectStore(STORES.rows);
    for (const { rowId, patch } of out.updates) {
        const row: Row | undefined = await req(store.get(rowId));
        // Values the run read, not the user's edits: `edits` is left as it is.
        if (row) store.put({ ...row, data: { ...row.data, ...patch } });
    }
    await done(tx);
    await update(listId, { columns: out.columns, view: { details: { tableId: detailId, urlColumn, matched: out.matched, unmatched: out.unmatched, at: Date.now() } } });
    return { matched: out.matched, unmatched: out.unmatched };
}

export const tables = { create, get, list, update, setColumns, renameColumn, removeColumn, updateRow, joinDetailsInto, rowCount, rowsPage, appendRows, clearRows, remove, save };
