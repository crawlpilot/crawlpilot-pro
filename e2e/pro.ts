/**
 * Pro's database from an extension page: read a store, or empty them all. The database is shared by
 * every test in a worker. Neither helper creates it: an open without a version would make an empty
 * database the app's own open could not upgrade.
 */
import type { Page } from '@playwright/test';

const DB = 'crawlpilot-pro';

export function proStore(page: Page, name: string): Promise<any[]> {
    return page.evaluate(([db, n]) => indexedDB.databases().then(list => new Promise<any[]>((resolve, reject) => {
        if (!list.some(d => d.name === db)) { resolve([]); return; }
        const open = indexedDB.open(db);
        open.onsuccess = () => {
            const conn = open.result;
            const req = conn.transaction(n).objectStore(n).getAll();
            req.onsuccess = () => { conn.close(); resolve(req.result); };
            req.onerror = () => { conn.close(); reject(req.error); };
        };
        open.onerror = () => reject(open.error);
    })), [DB, name] as const);
}

export function proClear(page: Page): Promise<void> {
    return page.evaluate(db => indexedDB.databases().then(list => new Promise<void>((resolve, reject) => {
        if (!list.some(d => d.name === db)) { resolve(); return; }
        const open = indexedDB.open(db);
        open.onsuccess = () => {
            const conn = open.result;
            const names = [...conn.objectStoreNames];
            if (names.length === 0) { conn.close(); resolve(); return; }
            const tx = conn.transaction(names, 'readwrite');
            names.forEach(n => tx.objectStore(n).clear());
            tx.oncomplete = () => { conn.close(); resolve(); };
            tx.onerror = () => { conn.close(); reject(tx.error); };
        };
        open.onerror = () => reject(open.error);
    })), DB);
}
