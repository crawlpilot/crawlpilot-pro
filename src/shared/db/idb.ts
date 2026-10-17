/** The IndexedDB connection and the few promise helpers every repository uses. */
import { DB_NAME, DB_VERSION, upgrade } from './schema';

let connection: Promise<IDBDatabase> | null = null;

/** The open database, opened (and upgraded) on first use. Reopens after the browser closes it. */
export function database(): Promise<IDBDatabase> {
    if (!connection) {
        connection = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = event => upgrade(request.result, event.oldVersion, request.transaction!);
            request.onsuccess = () => {
                const db = request.result;
                // Closed by a version change elsewhere or by eviction: the next call opens it again.
                db.onclose = () => { connection = null; };
                db.onversionchange = () => { db.close(); connection = null; };
                resolve(db);
            };
            request.onerror = () => { connection = null; reject(request.error); };
        });
    }
    return connection;
}

/** Closes the connection (tests, and before deleting the database). */
export async function closeDatabase(): Promise<void> {
    const open = connection;
    connection = null;
    if (open) (await open).close();
}

export function req<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** Resolves when the transaction commits. */
export function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    });
}

export async function transaction(stores: string | string[], mode: IDBTransactionMode = 'readonly'): Promise<IDBTransaction> {
    return (await database()).transaction(stores, mode);
}

/**
 * Walks a cursor, calling `visit` for each record until it returns false. Resolves with nothing when
 * the cursor ends or stops.
 */
export function walk<T>(request: IDBRequest<IDBCursorWithValue | null>, visit: (value: T, cursor: IDBCursorWithValue) => boolean | void): Promise<void> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor || visit(cursor.value as T, cursor) === false) { resolve(); return; }
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
    });
}
