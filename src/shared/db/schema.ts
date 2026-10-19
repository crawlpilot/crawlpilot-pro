/**
 * The IndexedDB schema: the database, its stores and indexes, and how each version upgrades.
 * Repositories (`tables.ts`, `jobs.ts`) are the only code that names a store.
 *
 * | Store     | Record | Indexes                                                |
 * |-----------|--------|--------------------------------------------------------|
 * | `recipes` | Recipe | `hash` (the spec's identity), `updatedAt`, `createdAt` |
 * | `jobs`    | Job    | `recipeId`, `status`, `createdAt`                      |
 * | `tables`  | Table  | `createdAt`, `jobId`                                   |
 * | `rows`    | Row    | `tableId`, `createdAt`, unique `[tableId, key]`        |
 *
 * Versions: v1–v3 held `automations`; v4 added `recipes` and `jobs` with a broken copy that v5
 * discards; v6 types recipes (`spec`, one per distinct spec) and jobs (`input`, `tableId`, no config
 * copy) and converts the v5 records once (`migrateToV6`); v7 moves `tableData`/`tableRows` to
 * `tables`/`rows` (`source`, `rowCount`, `preview`, `view`; a row's `key`) (`migrateToV7`).
 */
import type { Job, Recipe, Row, Table } from '../types/database';
import { specFromV5, specHash, specJson } from '../recipes/spec';
import { rowKey } from './tables';

export const DB_NAME = 'crawl-pilot';
export const DB_VERSION = 7;

export const STORES = {
    recipes: 'recipes',
    jobs: 'jobs',
    tables: 'tables',
    rows: 'rows',
} as const;

/** The v6 stores `migrateToV7` moves. */
const V6_TABLES = 'tableData';
const V6_ROWS = 'tableRows';

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string | string[], unique = false) {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique });
}

function dropIndex(store: IDBObjectStore, name: string) {
    if (store.indexNames.contains(name)) store.deleteIndex(name);
}

/** Brings a database at `oldVersion` to DB_VERSION inside the version-change transaction. */
export function upgrade(db: IDBDatabase, oldVersion: number, tx: IDBTransaction) {
    if (db.objectStoreNames.contains('automations')) db.deleteObjectStore('automations');
    if (oldVersion >= 4 && oldVersion < 5) {
        for (const name of [STORES.recipes, STORES.jobs]) {
            if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
        }
    }

    const store = (name: string) => db.objectStoreNames.contains(name)
        ? tx.objectStore(name)
        : db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });

    const tables = store(STORES.tables);
    ensureIndex(tables, 'createdAt', 'createdAt');
    ensureIndex(tables, 'jobId', 'jobId');

    const rows = store(STORES.rows);
    ensureIndex(rows, 'tableId', 'tableId');
    ensureIndex(rows, 'createdAt', 'createdAt');
    ensureIndex(rows, 'tableId_key', ['tableId', 'key'], true);

    const recipes = store(STORES.recipes);
    ensureIndex(recipes, 'hash', 'hash');
    ensureIndex(recipes, 'updatedAt', 'updatedAt');
    ensureIndex(recipes, 'createdAt', 'createdAt');
    dropIndex(recipes, 'type');

    const jobs = store(STORES.jobs);
    ensureIndex(jobs, 'recipeId', 'recipeId');
    ensureIndex(jobs, 'status', 'status');
    ensureIndex(jobs, 'createdAt', 'createdAt');
    dropIndex(jobs, 'sourceUrl');

    if (oldVersion >= 5 && oldVersion < 6) migrateToV6(recipes, jobs);
    if (db.objectStoreNames.contains(V6_TABLES)) migrateToV7(db, tx, tables, rows);
}

/** A v6 `tableData` record as a `Table`: run facts and view settings out of `metadata`. */
function tableFromV6(t: any, rowCount: number): Table {
    const md = t.metadata ?? {};
    const view: Table['view'] = {};
    if (md.columnMerges) view.merges = md.columnMerges;
    if (md.columnTypes) view.typed = md.columnTypes;
    if (md.outputMapping) view.mapping = md.outputMapping;
    return {
        id: t.id,
        name: t.name ?? 'Extraction',
        ...(t.jobId !== undefined ? { jobId: t.jobId } : {}),
        source: md.extractionType || md.source || 'list',
        sourceUrl: t.sourceUrl ?? '',
        columns: t.columns ?? [],
        rowCount,
        preview: md.isPreview === true,
        view,
        createdAt: t.createdAt ?? 0,
        updatedAt: t.updatedAt ?? t.createdAt ?? 0,
    };
}

/**
 * v6 → v7. Tables move to `tables` (same ids, so jobs' `tableId` stay valid) and rows to `rows`,
 * read with a cursor so a large table is never held at once. A row keeps its data and gets its
 * `key`; a second row with the same key in a table (the same item read on two pages) is dropped,
 * and each table's `rowCount` is what was kept. The v6 stores are deleted at the end.
 */
export function migrateToV7(db: IDBDatabase, tx: IDBTransaction, tables: IDBObjectStore, rows: IDBObjectStore) {
    const oldTablesReq = tx.objectStore(V6_TABLES).getAll();
    oldTablesReq.onsuccess = () => {
        const oldTables: any[] = oldTablesReq.result;
        const keys = new Map<number, Set<string>>();
        const counts = new Map<number, number>();
        const cursorReq = tx.objectStore(V6_ROWS).openCursor();
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
                const old = cursor.value;
                const tableId: number = old.tableDataId;
                const data = old.data ?? {};
                const key = rowKey(data);
                const seen = keys.get(tableId) ?? new Set<string>();
                keys.set(tableId, seen);
                if (!seen.has(key)) {
                    seen.add(key);
                    counts.set(tableId, (counts.get(tableId) ?? 0) + 1);
                    rows.put({ id: old.id, tableId, data, key, createdAt: old.createdAt ?? 0 } satisfies Row);
                }
                cursor.continue();
                return;
            }
            oldTables.forEach(t => tables.put(tableFromV6(t, counts.get(t.id) ?? 0)));
            db.deleteObjectStore(V6_TABLES);
            db.deleteObjectStore(V6_ROWS);
        };
    };
}

const V5_STATUS: Record<string, Job['status']> = { running: 'stopped', completed: 'completed', failed: 'failed', paused: 'stopped', pending: 'stopped' };

/**
 * v5 → v6. Each v5 recipe and each job's config snapshot becomes a typed spec; identical specs are
 * one recipe (keeping the oldest id, so v5 ids stay valid), and each job points to the recipe of
 * the config it actually ran. A job whose config can't be read keeps its record without a recipe.
 * Runs inside the version-change transaction: if anything throws, the database stays at v5.
 */
export function migrateToV6(recipes: IDBObjectStore, jobs: IDBObjectStore) {
    const oldRecipesReq = recipes.getAll();
    oldRecipesReq.onsuccess = () => {
        const oldJobsReq = jobs.getAll();
        oldJobsReq.onsuccess = () => {
            const oldRecipes: any[] = oldRecipesReq.result;
            const oldJobs: any[] = oldJobsReq.result;
            const byHash = new Map<string, Recipe>();
            const kept = new Map<number, Recipe>();
            let nextId = Math.max(0, ...oldRecipes.map(r => r.id ?? 0)) + 1;

            const recipeFor = (config: unknown, name: string, createdAt: number, id?: number): Recipe | null => {
                const spec = specFromV5(config);
                if (!spec) return null;
                const hash = specHash(spec);
                const same = byHash.get(hash);
                if (same && specJson(same.spec) === specJson(spec)) return same;
                const recipe: Recipe = { id: id ?? nextId++, name, spec, hash, rev: 1, createdAt, updatedAt: createdAt };
                byHash.set(hash, recipe);
                kept.set(recipe.id!, recipe);
                return recipe;
            };

            const fromRecipe = new Map<number, Recipe | null>();
            [...oldRecipes].sort((a, b) => (a.id ?? 0) - (b.id ?? 0)).forEach(r =>
                fromRecipe.set(r.id, recipeFor(r.config, r.name || 'Untitled', r.createdAt ?? Date.now(), r.id)));

            const newJobs: Job[] = oldJobs.map(j => {
                const recipe = (j.configSnapshot ? recipeFor(j.configSnapshot, fromRecipe.get(j.recipeId)?.name ?? j.name ?? 'Untitled', j.createdAt ?? Date.now()) : null)
                    ?? fromRecipe.get(j.recipeId) ?? null;
                const config = j.configSnapshot ?? oldRecipes.find(r => r.id === j.recipeId)?.config;
                const urls: string[] = Array.isArray(config?.urls) && config.urls.length > 0 ? config.urls : j.sourceUrl ? [j.sourceUrl] : [];
                const maxPages = config?.options?.pagination?.maxPages;
                return {
                    id: j.id,
                    recipeId: recipe?.id ?? j.recipeId,
                    recipeRev: recipe ? 1 : 0,
                    ...(j.name ? { name: j.name } : {}),
                    status: V5_STATUS[j.status] ?? 'stopped',
                    input: { urls, ...(maxPages ? { maxPages } : {}) },
                    stats: j.stats ?? { startTime: j.createdAt ?? 0, itemsExtracted: 0 },
                    ...(j.result?.tableDataId ? { tableId: j.result.tableDataId } : {}),
                    ...(j.error ? { error: j.error } : {}),
                    createdAt: j.createdAt ?? 0,
                    updatedAt: j.updatedAt ?? j.createdAt ?? 0,
                };
            });

            recipes.clear();
            jobs.clear();
            kept.forEach(r => recipes.put(r));
            newJobs.forEach(j => jobs.put(j));
        };
    };
}
