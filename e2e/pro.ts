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
    const { createServer } = await import('node:http');
    const { createMockBackend } = await import('../src/pro/backend/mock');
    const backend = createMockBackend();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, idempotency-key', 'access-control-allow-methods': 'GET, POST' };
    const server = createServer((req, res) => {
        if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
            const out = backend.handle({ method: req.method ?? 'GET', path: req.url ?? '/', headers, body });
            res.writeHead(out.status, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(out.body));
        });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as { port: number };
    return { origin: `http://127.0.0.1:${port}`, backend, close: () => server.close() };
}
