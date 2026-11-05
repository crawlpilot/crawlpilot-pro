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

/** Empties Pro's database and forgets the name set in the Backend dialog. */
export async function proClear(page: Page): Promise<void> {
    await page.evaluate(() => chrome.storage.local.remove('pro.user'));
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

/** Uses Pro as someone else: the name kept on saves and reviews (Backend dialog, on the Recipes screen). */
export async function proSetName(ui: Page, name: string): Promise<void> {
    await ui.getByRole('button', { name: 'Backend' }).click();
    await ui.getByLabel('Your name').fill(name);
    await ui.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
}

/** The mock crawler backend (`src/pro/backend/mock.ts`) on a local port, with CORS as a real API would send. */
export async function serveMockBackend(): Promise<{ origin: string; backend: import('../src/pro/backend/mock').MockBackend; close: () => void }> {
    const { startMockServer } = await import('../src/pro/backend/mockServer');
    return startMockServer();
}
