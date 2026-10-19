/**
 * The e2e harness: Chromium with the built extension loaded, a local server for the pages, and an
 * extension page (`sidepanel.html` in a tab) that talks to the background and content scripts the
 * way the side panel does: `{ type, payload }` messages (`src/shared/messages.ts`).
 *
 * - `/corpus/<name>` serves `src/test/fixtures/corpus/<name>.html.gz` with page scripts blocked
 *   (saved retail pages would otherwise try to boot their apps); content scripts are not affected.
 * - `/site/<file>` serves `e2e/site/<file>` as is, scripts allowed.
 */
import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const CORPUS = path.join(ROOT, 'src/test/fixtures/corpus');
const SITE = path.join(ROOT, 'e2e/site');

function serve(): Promise<{ server: Server; origin: string }> {
    const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        try {
            if (url.pathname.startsWith('/corpus/')) {
                const name = path.basename(url.pathname);
                const html = gunzipSync(await readFile(path.join(CORPUS, `${name}.html.gz`)));
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "script-src 'none'" });
                res.end(html);
                return;
            }
            if (url.pathname.startsWith('/site/')) {
                const body = await readFile(path.join(SITE, path.basename(url.pathname)));
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                res.end(body);
                return;
            }
            res.writeHead(404).end();
        } catch {
            res.writeHead(404).end();
        }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number };
        resolve({ server, origin: `http://127.0.0.1:${port}` });
    }));
}

/** An extension page: sends messages and records every broadcast it receives. */
export class Panel {
    constructor(readonly page: Page, readonly extensionId: string) {}

    static async open(context: BrowserContext, extensionId: string): Promise<Panel> {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
        await page.evaluate(() => {
            (window as any).__inbox = [];
            chrome.runtime.onMessage.addListener((msg: any) => { (window as any).__inbox.push(msg); });
        });
        return new Panel(page, extensionId);
    }

    /** The id of the tab showing `url`. */
    tabId(url: string): Promise<number> {
        return this.page.evaluate(async u => {
            const tabs = await chrome.tabs.query({});
            const tab = tabs.find(t => t.url === u);
            if (!tab?.id) throw new Error(`No tab at ${u}`);
            return tab.id;
        }, url);
    }

    toTab(tabId: number, type: string, payload?: unknown): Promise<any> {
        return this.page.evaluate(([id, t, p]) => chrome.tabs.sendMessage(id as number, { type: t, payload: p }), [tabId, type, payload] as const);
    }

    toExtension(type: string, payload?: unknown): Promise<any> {
        return this.page.evaluate(([t, p]) => chrome.runtime.sendMessage({ type: t, payload: p }), [type, payload] as const);
    }

    /** Broadcasts of `type` received so far. */
    received(type: string): Promise<any[]> {
        return this.page.evaluate(t => (window as any).__inbox.filter((m: any) => m.type === t).map((m: any) => m.payload), type);
    }

    clear(): Promise<void> {
        return this.page.evaluate(() => { (window as any).__inbox = []; });
    }

    /** Waits for the first broadcast of `type` (from now or already received) and returns its payload. */
    async next(type: string, timeout = 20_000): Promise<any> {
        await this.page.waitForFunction(t => (window as any).__inbox.some((m: any) => m.type === t), type, { timeout });
        return (await this.received(type))[0];
    }

    /** Reads every record of a store in the extension's database. */
    store(name: string): Promise<any[]> {
        return this.page.evaluate(n => new Promise<any[]>((resolve, reject) => {
            const open = indexedDB.open('crawl-pilot');
            open.onsuccess = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains(n)) { db.close(); resolve([]); return; }
                const req = db.transaction(n).objectStore(n).getAll();
                req.onsuccess = () => { db.close(); resolve(req.result); };
                req.onerror = () => { db.close(); reject(req.error); };
            };
            open.onerror = () => reject(open.error);
        }), name);
    }
}

/**
 * Picks the list holding `target` the way a user does: start the list picker, hover, click.
 * Returns the `ELEMENT_SELECTED` payload.
 */
export async function pickList(panel: Panel, page: Page, target: string): Promise<any> {
    await panel.clear();
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'START_PICKER', { mode: 'list', action: 'extract' });
    await hoverAndClick(page, target);
    return panel.next('ELEMENT_SELECTED');
}

/** Picks one element with the single picker (a Next button: `action: 'click'`). */
export async function pickElement(panel: Panel, page: Page, target: string, action: 'extract' | 'click' = 'click'): Promise<any> {
    await panel.clear();
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'START_PICKER', { mode: 'single', action });
    await hoverAndClick(page, target);
    return panel.next('ELEMENT_SELECTED');
}

async function hoverAndClick(page: Page, target: string) {
    const el = page.locator(target).first();
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    if (!box) throw new Error(`${target} has no box`);
    const x = box.x + Math.min(box.width / 2, 20);
    const y = box.y + Math.min(box.height / 2, 10);
    // The picker reads the hovered element on the next animation frame.
    await page.mouse.move(x - 2, y - 2);
    await page.mouse.move(x, y);
    await page.waitForTimeout(150);
    await page.mouse.click(x, y);
}

type Fixtures = { panel: Panel; origin: string };
type WorkerFixtures = { ext: BrowserContext; extensionId: string; server: { origin: string }; worker: Worker };

export const test = base.extend<Fixtures, WorkerFixtures>({
    ext: [async ({}, use) => {
        if (!fs.existsSync(path.join(DIST, 'manifest.json'))) throw new Error('Build first: npm run build');
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'crawlpilot-e2e-'));
        // A copy whose manifest grants `<all_urls>` at install: what the side panel's Connect banner
        // asks for at runtime (a browser prompt a test can't answer). Without it, tab URLs are hidden
        // and runs can't inject into pages.
        const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'crawlpilot-ext-'));
        fs.cpSync(DIST, extension, { recursive: true });
        const manifestPath = path.join(extension, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.host_permissions = ['<all_urls>'];
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        const context = await chromium.launchPersistentContext(profile, {
            channel: 'chromium',
            headless: !process.env.HEADED,
            viewport: { width: 1280, height: 900 },
            args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
        });
        await use(context);
        await context.close();
        fs.rmSync(profile, { recursive: true, force: true });
        fs.rmSync(extension, { recursive: true, force: true });
    }, { scope: 'worker' }],
    worker: [async ({ ext }, use) => {
        const sw = ext.serviceWorkers()[0] ?? await ext.waitForEvent('serviceworker');
        await use(sw);
    }, { scope: 'worker' }],
    extensionId: [async ({ worker }, use) => {
        await use(new URL(worker.url()).host);
    }, { scope: 'worker' }],
    server: [async ({}, use) => {
        const { server, origin } = await serve();
        await use({ origin });
        server.close();
    }, { scope: 'worker' }],
    origin: async ({ server }, use) => { await use(server.origin); },
    panel: async ({ ext, extensionId }, use) => {
        const panel = await Panel.open(ext, extensionId);
        await use(panel);
        await panel.page.close();
    },
});

export { expect } from '@playwright/test';
