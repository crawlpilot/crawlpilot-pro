/** Datasets (`tableData`) and their rows (`tableRows`). */
import type { Column, ExtractionResult, TableData, TableRow } from '../types/database';
import { hashString } from '../utils/hash';
import { done, req, transaction, walk } from './idb';
import { STORES, StoredRow } from './schema';

export interface SaveOptions {
    name?: string;
    jobId?: number;
    /** Write into this table (a preview, or this job's own table) instead of creating one. */
    tableDataId?: number;
    isPreview?: boolean;
    /** Replace the table's rows instead of appending. */
    clearExisting?: boolean;
}

function sortKeys(value: any): any {
    if (typeof value !== 'object' || value === null) return value;
    if (Array.isArray(value)) return value.map(sortKeys);
    return Object.keys(value).sort().reduce((out: any, k) => { out[k] = sortKeys(value[k]); return out; }, {});
}

function rowHash(data: Record<string, any>): string {
    return hashString(JSON.stringify(sortKeys(data))).toString();
}

async function create(table: Omit<TableData, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
    const now = Date.now();
    const tx = await transaction(STORES.tables, 'readwrite');
    return await req(tx.objectStore(STORES.tables).add({ ...table, columns: table.columns ?? [], createdAt: now, updatedAt: now })) as number;
}

async function get(id: number): Promise<TableData | null> {
    const tx = await transaction(STORES.tables);
    return (await req(tx.objectStore(STORES.tables).get(id))) ?? null;
}

/** Newest first. */
async function list(limit = 50): Promise<TableData[]> {
    const tx = await transaction(STORES.tables);
    const out: TableData[] = [];
    await walk<TableData>(tx.objectStore(STORES.tables).index('createdAt').openCursor(null, 'prev'), t => {
        out.push(t);
        return out.length < limit;
    });
    return out;
}

/** Updates fields; `metadata` is merged key by key, everything else replaced. */
async function update(id: number, patch: Partial<TableData>): Promise<void> {
    const tx = await transaction(STORES.tables, 'readwrite');
    const store = tx.objectStore(STORES.tables);
    const current: TableData | undefined = await req(store.get(id));
    if (!current) throw new Error(`Table ${id} not found`);
    store.put({ ...current, ...patch, metadata: { ...current.metadata, ...patch.metadata }, updatedAt: Date.now() });
    await done(tx);
}

/** The table's columns, replaced as a whole: a run's columns are final, never merged with older ones. */
function setColumns(id: number, columns: Column[]): Promise<void> {
    return update(id, { columns });
}

async function renameColumn(id: number, columnId: string, name: string): Promise<void> {
    const table = await get(id);
    if (!table) throw new Error(`Table ${id} not found`);
    await setColumns(id, table.columns.map(c => (c.id === columnId ? { ...c, name } : c)));
}

async function rowCount(id: number): Promise<number> {
    const tx = await transaction(STORES.rows);
    return req(tx.objectStore(STORES.rows).index('tableDataId').count(IDBKeyRange.only(id)));
}

/** Rows in insertion order, `offset` skipped. */
async function rowsPage(id: number, offset: number, limit: number): Promise<TableRow[]> {
    const tx = await transaction(STORES.rows);
    const request = tx.objectStore(STORES.rows).index('tableDataId').openCursor(IDBKeyRange.only(id));
    const out: TableRow[] = [];
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
 * Appends rows, skipping any the table already has (same data). Returns how many were stored and
 * records the table's row count from what is actually stored.
 */
async function appendRows(id: number, items: Record<string, any>[]): Promise<number> {
    if (items.length === 0) return 0;
    const tx = await transaction(STORES.rows, 'readwrite');
    const store = tx.objectStore(STORES.rows);
    const byHash = store.index('tableData_dataHash');
    const now = Date.now();
    let stored = 0;
    const batch = new Set<string>();
    for (const data of items) {
        const dataHash = rowHash(data);
        if (batch.has(dataHash)) continue;
        batch.add(dataHash);
        const row: StoredRow = { tableDataId: id, data, dataHash, createdAt: now };
        // Rows already in the table (an earlier page or batch) are skipped, not added and rejected.
        const seen = byHash.count([id, dataHash]);
        seen.onsuccess = () => {
            if (seen.result > 0) return;
            store.add(row).onsuccess = () => { stored++; };
        };
    }
    await done(tx);
    await update(id, { metadata: { totalRows: await rowCount(id) } });
    return stored;
}

async function clearRows(id: number): Promise<void> {
    const tx = await transaction(STORES.rows, 'readwrite');
    await walk(tx.objectStore(STORES.rows).index('tableDataId').openCursor(IDBKeyRange.only(id)), (_, c) => { c.delete(); });
    await done(tx);
}

/** Deletes a table and its rows. */
async function remove(id: number): Promise<void> {
    const tx = await transaction([STORES.tables, STORES.rows], 'readwrite');
    tx.objectStore(STORES.tables).delete(id);
    await walk(tx.objectStore(STORES.rows).index('tableDataId').openCursor(IDBKeyRange.only(id)), (_, c) => { c.delete(); });
    await done(tx);
}

/** Preview tables no job owns, except `keep`: a new preview replaces the ones left from earlier picks. */
async function removeLoosePreviews(keep: number): Promise<void> {
    const tx = await transaction(STORES.tables);
    const loose: number[] = [];
    await walk<TableData>(tx.objectStore(STORES.tables).openCursor(), t => {
        if (t.id !== keep && t.metadata?.isPreview === true && t.jobId === undefined) loose.push(t.id!);
    });
    for (const id of loose) await remove(id);
}

/**
 * Saves an extraction: into `tableDataId` when it is a preview or this job's table, otherwise into a
 * new table. Rows are appended (or replace the old ones with `clearExisting`), columns replaced.
 */
async function save(result: ExtractionResult, options: SaveOptions = {}): Promise<number> {
    const preview = options.isPreview ?? false;
    const baseName = options.name || 'Extraction';
    const name = preview ? `Preview: ${baseName}` : baseName;
    const extractionType = result.type || 'list';

    let id = options.tableDataId;
    if (id !== undefined) {
        const existing = await get(id);
        // Gone, or another job's finished table: never overwrite it.
        if (!existing || (existing.metadata?.isPreview !== true && existing.jobId !== options.jobId)) id = undefined;
    }

    if (id !== undefined) {
        if (options.clearExisting) await clearRows(id);
        await update(id, { name, jobId: options.jobId, metadata: { extractionType, isPreview: preview } });
    } else {
        id = await create({
            name,
            columns: [],
            sourceUrl: result.source_url || (typeof window !== 'undefined' ? window.location.href : 'unknown'),
            jobId: options.jobId,
            metadata: { extractionType, totalRows: 0, isPreview: preview },
        });
        if (preview && options.jobId === undefined) await removeLoosePreviews(id);
    }

    await appendRows(id, result.items ?? []);
    if (result.columns?.length) await setColumns(id, result.columns);
    return id;
}

export const tables = { create, get, list, update, setColumns, renameColumn, rowCount, rowsPage, appendRows, clearRows, remove, save };
