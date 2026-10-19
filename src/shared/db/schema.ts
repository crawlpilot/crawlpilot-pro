/**
 * The IndexedDB schema: the database, its stores and indexes, and how each version upgrades.
 * Repositories (`tables.ts`, `jobs.ts`) are the only code that names a store.
 *
 * | Store       | Record       | Indexes                                                     |
 * |-------------|--------------|-------------------------------------------------------------|
 * | `recipes`   | Recipe       | `hash` (the spec's identity), `updatedAt`, `createdAt`      |
 * | `jobs`      | Job          | `recipeId`, `status`, `createdAt`                           |
 * | `tableData` | TableData    | `name`, `createdAt`, `jobId`                                |
 * | `tableRows` | StoredRow    | `tableDataId`, `createdAt`, unique `[tableDataId, dataHash]` |
 *
 * Versions: v1–v3 held `automations`; v4 added `recipes` and `jobs` with a broken copy that v5
 * discards; v6 types recipes (`spec`, one per distinct spec) and jobs (`input`, `tableId`, no config
 * copy) and converts the v5 records once (`migrateToV6`).
 */
import type { Job, Recipe } from '../types/database';
import { specFromV5, specHash, specJson } from '../recipes/spec';

export const DB_NAME = 'crawl-pilot';
export const DB_VERSION = 6;

export const STORES = {
    recipes: 'recipes',
    jobs: 'jobs',
    tables: 'tableData',
    rows: 'tableRows',
} as const;

/** A row as stored: its data once, and the hash that keeps a table free of duplicates. */
export interface StoredRow {
    id?: number;
    tableDataId: number;
    data: Record<string, any>;
    dataHash: string;
    createdAt: number;
}

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
    ensureIndex(tables, 'name', 'name');
    ensureIndex(tables, 'createdAt', 'createdAt');
    ensureIndex(tables, 'jobId', 'jobId');
    dropIndex(tables, 'automationId');

    const rows = store(STORES.rows);
    ensureIndex(rows, 'tableDataId', 'tableDataId');
    ensureIndex(rows, 'createdAt', 'createdAt');
    ensureIndex(rows, 'tableData_dataHash', ['tableDataId', 'dataHash'], true);

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
