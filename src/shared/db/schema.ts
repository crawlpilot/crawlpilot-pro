/**
 * The IndexedDB schema: the database, its stores and indexes, and how each version upgrades.
 * Repositories (`tables.ts`, `jobs.ts`, `recipes.ts`) are the only code that names a store.
 *
 * | Store       | Record        | Indexes                                              |
 * |-------------|---------------|------------------------------------------------------|
 * | `recipes`   | AutomationRecipe | `type`, `createdAt`                               |
 * | `jobs`      | Job           | `recipeId`, `status`, `sourceUrl`, `createdAt`       |
 * | `tableData` | TableData     | `name`, `createdAt`, `automationId` (unused, removed in v6) |
 * | `tableRows` | StoredRow     | `tableDataId`, `createdAt`, unique `[tableDataId, dataHash]` |
 */
export const DB_NAME = 'crawl-pilot';
export const DB_VERSION = 5;

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

/**
 * Brings a database at `oldVersion` to DB_VERSION inside the version-change transaction.
 * v1–v3 held `automations`; v4 added `recipes` and `jobs` with a broken copy that v5 discards.
 */
export function upgrade(db: IDBDatabase, oldVersion: number, _tx: IDBTransaction) {
    if (db.objectStoreNames.contains('automations')) db.deleteObjectStore('automations');

    if (!db.objectStoreNames.contains(STORES.tables)) {
        const store = db.createObjectStore(STORES.tables, { keyPath: 'id', autoIncrement: true });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('automationId', 'automationId', { unique: false });
    }
    if (!db.objectStoreNames.contains(STORES.rows)) {
        const store = db.createObjectStore(STORES.rows, { keyPath: 'id', autoIncrement: true });
        store.createIndex('tableDataId', 'tableDataId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('tableData_dataHash', ['tableDataId', 'dataHash'], { unique: true });
    }

    if (oldVersion >= 4 && oldVersion < 5) {
        for (const name of [STORES.recipes, STORES.jobs]) {
            if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
        }
    }
    if (!db.objectStoreNames.contains(STORES.recipes)) {
        const store = db.createObjectStore(STORES.recipes, { keyPath: 'id', autoIncrement: true });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
    }
    if (!db.objectStoreNames.contains(STORES.jobs)) {
        const store = db.createObjectStore(STORES.jobs, { keyPath: 'id', autoIncrement: true });
        store.createIndex('recipeId', 'recipeId', { unique: false });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('sourceUrl', 'sourceUrl', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
    }
}
