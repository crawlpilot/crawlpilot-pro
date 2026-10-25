/** The connection to Pro's database. The promise helpers are the public ones (`shared/db/idb.ts`). */
import { PRO_DB_NAME, PRO_DB_VERSION, upgrade } from './schema';

let connection: Promise<IDBDatabase> | null = null;

export function proDatabase(): Promise<IDBDatabase> {
    if (!connection) {
        connection = new Promise((resolve, reject) => {
            const request = indexedDB.open(PRO_DB_NAME, PRO_DB_VERSION);
            request.onupgradeneeded = event => upgrade(request.result, event.oldVersion);
            request.onsuccess = () => {
                const db = request.result;
                db.onclose = () => { connection = null; };
                db.onversionchange = () => { db.close(); connection = null; };
                resolve(db);
            };
            request.onerror = () => { connection = null; reject(request.error); };
        });
    }
    return connection;
}

/** Closes the connection (tests). */
export async function closeProDatabase(): Promise<void> {
    const open = connection;
    connection = null;
    if (open) (await open).close();
}

export async function proTransaction(stores: string | string[], mode: IDBTransactionMode = 'readonly'): Promise<IDBTransaction> {
    return (await proDatabase()).transaction(stores, mode);
}
