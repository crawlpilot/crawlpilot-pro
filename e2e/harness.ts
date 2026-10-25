/**
 * The e2e harness: Chromium with the built extension loaded, a local server for the pages, and an
 * extension page (`sidepanel.html` in a tab) that talks to the background and content scripts the
 * way the side panel does: `{ type, payload }` messages (`src/shared/messages.ts`).
 *
 * - `/corpus/<name>` serves `src/test/fixtures/corpus/<name>.html.gz` with page scripts blocked
 *   (saved retail pages would otherwise try to boot their apps); content scripts are not affected.
 * - `/site/<file>` serves `e2e/site/<file>` as is, scripts allowed; `?delay=ms` sends it that much later,
 *   `?status=429` with that status.
 * - `/feed/posts?after=&size=&total=` a social feed's posts as a GraphQL-style connection (`total=0`: endless).
 * - `/img/<name>-<w>x<h>.<ext>` and `/cdn/<name>?id=&w=&h=` serve a generated PNG of that size (any
 *   extension: the bytes are PNG, which browsers sniff), for the Image Downloader: one picture per
 *   name (or per `?pic=`), at whatever size is asked. Names starting
 *   `protected-` need this site as Referer, `private-` a `session=1` cookie; `missing-` is a 404 and
 *   `notimage-` an HTML page. `/wp-content/uploads/<name>-<w>x<h>.<ext>` is that size and
 *   `/wp-content/uploads/<name>.<ext>` the 2400×1600 original, like WordPress.
 */
import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { deflateSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const CORPUS = path.join(ROOT, 'src/test/fixtures/corpus');
const SITE = path.join(ROOT, 'e2e/site');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(bytes: Buffer): number {
    let c = 0xffffffff;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** A number from a name: the same picture for the same name. */
function seedOf(name: string): number {
    let h = 2166136261;
    for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
}

/**
 * A PNG, `width`×`height`: grey ramps across 8 vertical bands, each rising or falling by a bit of
 * `seed`. The pattern scales with the image, so one seed is one picture at any size (a perceptual
 * hash matches) and different seeds are different pictures.
 */
export function png(width: number, height: number, seed = 0): Buffer {
    const chunk = (type: string, data: Buffer) => {
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const out = Buffer.alloc(body.length + 8);
        out.writeUInt32BE(data.length, 0);
        body.copy(out, 4);
        out.writeUInt32BE(crc32(body), body.length + 4);
        return out;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
        const band = Math.floor(x * 8 / width);
        const t = (x * 8 / width) - band;
        const v = Math.round(((seed >>> band) & 1 ? t : 1 - t) * 200 + 30);
        row[1 + x * 3] = v; row[2 + x * 3] = v; row[3 + x * 3] = v;
    }
    const pixels = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

/** The fake Apps Script's secret (set by a test from the one CrawlPilot generated) and its tabs. */
const sheetScript: { secret: string; tabs: Record<string, { header: string[]; rows: unknown[][] }> } = { secret: '', tabs: {} };

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
            // Image Downloader failure cases: hotlink protection (needs this site as Referer), a login
            // (needs the page's cookie), gone, and a web page where an image should be.
            const name = path.basename(url.pathname);
            if (name.startsWith('protected-') && !(req.headers.referer ?? '').startsWith(`http://${req.headers.host}/`)) { res.writeHead(403).end('No hotlinking'); return; }
            if (name.startsWith('private-') && !/(^|;\s*)session=1/.test(req.headers.cookie ?? '')) { res.writeHead(401).end('Log in'); return; }
            if (name.startsWith('missing-')) { res.writeHead(404).end(); return; }
            if (name.startsWith('notimage-')) { res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body>Hotlinking not allowed</body></html>'); return; }
            // A WordPress uploads folder: `photo-300x200.jpg` is that size, `photo.jpg` the 2400×1600 original.
            if (url.pathname.startsWith('/wp-content/uploads/')) {
                const wp = /-(\d+)x(\d+)\.\w+$/.exec(url.pathname);
                res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
                res.end(png(wp ? Number(wp[1]) : 2400, wp ? Number(wp[2]) : 1600, seedOf(url.pathname.replace(/-\d+x\d+(?=\.\w+$)/, ''))));
                return;
            }
            const sized = /^\/img\/[\w-]*?-(\d+)x(\d+)\.\w+$/.exec(url.pathname);
            if (sized || url.pathname.startsWith('/cdn/')) {
                const w = Number(sized?.[1] ?? url.searchParams.get('w') ?? 100);
                const h = Number(sized?.[2] ?? url.searchParams.get('h') ?? 100);
                res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
                // The picture: `?pic=` when given (one picture under unrelated URLs), else the name without its size.
                const picture = url.searchParams.get('pic') ?? (url.pathname.startsWith('/cdn/') ? url.pathname + (url.searchParams.get('id') ?? '') : name.replace(/-\d+x\d+\.\w+$/, ''));
                res.end(png(Math.min(w, 4000), Math.min(h, 4000), seedOf(picture)));
                return;
            }
            // A Google Sheet's Apps Script web app (shared/integrations/sheets.ts), as the real script
            // writes: tabs of a header and rows. `/log` shows them.
            if (url.pathname === '/macros/s/test/exec' && req.method === 'POST') {
                let raw = '';
                for await (const chunk of req) raw += chunk;
                const body = JSON.parse(raw);
                res.writeHead(200, { 'content-type': 'application/json' });
                if (body.secret !== sheetScript.secret) { res.end(JSON.stringify({ ok: false, error: 'Wrong key' })); return; }
                if (body.test) { res.end(JSON.stringify({ ok: true, name: 'Test sheet', url: 'https://docs.google.com/spreadsheets/d/test' })); return; }
                const tab = (sheetScript.tabs[body.sheet] ??= { header: [], rows: [] });
                for (const c of body.columns) if (!tab.header.includes(c)) tab.header.push(c);
                for (const r of body.rows) tab.rows.push(tab.header.map((h: string) => r[h] ?? ''));
                res.end(JSON.stringify({ ok: true, added: body.rows.length, url: `https://docs.google.com/spreadsheets/d/test#gid=${encodeURIComponent(body.sheet)}` }));
                return;
            }
            if (url.pathname === '/macros/s/test/log') {
                res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(sheetScript.tabs));
                return;
            }
            if (url.pathname === '/macros/s/test/key' && req.method === 'POST') {
                let raw = '';
                for await (const chunk of req) raw += chunk;
                sheetScript.secret = raw;
                res.writeHead(200).end();
                return;
            }
            // A shop's JSON API (API recipes): needs the page's session cookie. `/api/products` pages by
            // `page` (3 pages of 10 per query); `/api/graphql` by a cursor in the body (25 items, 10 a page).
            if (url.pathname.startsWith('/api/')) {
                if (!/(^|;\s*)session=1/.test(req.headers.cookie ?? '')) { res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"login"}'); return; }
                res.writeHead(200, { 'content-type': 'application/json' });
                if (url.pathname === '/api/products') {
                    const q = url.searchParams.get('q') ?? '';
                    const page = Number(url.searchParams.get('page') ?? 1);
                    const products = page > 3 ? [] : Array.from({ length: 10 }, (_, i) => ({ id: `${q}-${(page - 1) * 10 + i + 1}`, title: `${q} ${(page - 1) * 10 + i + 1}`, price: { value: 10 + i, currency: 'USD' } }));
                    res.end(JSON.stringify({ query: q, page, totalPages: 3, products }));
                    return;
                }
                if (url.pathname === '/api/graphql' && req.method === 'POST') {
                    let raw = '';
                    for await (const chunk of req) raw += chunk;
                    const after = Number(JSON.parse(raw).variables?.after || 0);
                    const edges = Array.from({ length: Math.max(0, Math.min(10, 25 - after)) }, (_, i) => ({ node: { sku: `G${after + i + 1}`, name: `Gadget ${after + i + 1}` } }));
                    const end = after + edges.length;
                    res.end(JSON.stringify({ data: { catalog: { edges, pageInfo: { hasNextPage: end < 25, endCursor: end < 25 ? String(end) : null } } } }));
                    return;
                }
                res.end('{}');
                return;
            }
            // A social feed's API (virtual-grid.html, virtual-feed.html): `after` posts in, `size` a page,
            // `total` in all (`total=0`: endless). Shaped like a GraphQL connection.
            if (url.pathname === '/feed/posts') {
                const after = Number(url.searchParams.get('after') || 0);
                const size = Number(url.searchParams.get('size') || 12);
                const total = Number(url.searchParams.get('total') ?? 120);
                const count = total ? Math.max(0, Math.min(size, total - after)) : size;
                const edges = Array.from({ length: count }, (_, i) => {
                    const n = after + i + 1;
                    return { node: {
                        code: `C${n.toString(36).padStart(4, '0')}x`, pk: String(9000 + n), media_type: n % 3 === 0 ? 2 : 1,
                        caption: { text: `Post ${n}: a day at the coast #${n}` }, taken_at: 1790000000 + n * 3600,
                        user: { username: n % 4 === 0 ? 'beta' : 'alpha' }, sponsored: n % 7 === 0,
                    } };
                });
                const end = after + count;
                const more = !total || end < total;
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ data: { user: { timeline: { edges, page_info: { end_cursor: more ? String(end) : null, has_next_page: more } } } } }));
                return;
            }
            if (url.pathname.startsWith('/site/')) {
                // `?delay=ms`: a page slow to arrive (a struggling computer or a slow site).
                const delay = Number(url.searchParams.get('delay') || 0);
                if (delay > 0) await new Promise(r => setTimeout(r, Math.min(delay, 60_000)));
                const body = await readFile(path.join(SITE, path.basename(url.pathname)));
                // `?status=429`: the page answered with that status (a rate limit, an error).
                res.writeHead(Number(url.searchParams.get('status') || 200), { 'content-type': 'text/html; charset=utf-8' });
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

    /** Sends to a tab's content script; on a page that just loaded it may not be listening yet, so retry for up to 5 s. */
    toTab(tabId: number, type: string, payload?: unknown): Promise<any> {
        return this.page.evaluate(async ([id, t, p]) => {
            for (let tries = 0; ; tries++) {
                try {
                    return await chrome.tabs.sendMessage(id as number, { type: t, payload: p });
                } catch (e) {
                    if (tries >= 50 || !/Receiving end does not exist/.test(String(e))) throw e;
                    await new Promise(r => setTimeout(r, 100));
                }
            }
        }, [tabId, type, payload] as const);
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
/**
 * On My data, saves the newest run whose card shows `hasText` as a recipe (a run's recipe is off the
 * Recipes screen until saved), named `name` if given, and opens the Recipes tab.
 */
export async function saveAsRecipe(ui: Page, hasText: string | RegExp, name?: string): Promise<void> {
    await ui.getByRole('tab', { name: 'Data' }).click();
    await ui.getByTestId('data-card').filter({ hasText }).first().getByRole('button', { name: 'More' }).click();
    await ui.getByRole('menuitem', { name: 'Save as recipe' }).click();
    if (name) await ui.getByRole('dialog').getByRole('textbox').fill(name);
    await ui.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await ui.getByRole('tab', { name: 'Recipes' }).click();
}

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
            // EXTRA_ARGS: more Chromium flags (`--window-position=-3000,-3000` keeps a HEADED run off screen).
            args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...(process.env.EXTRA_ARGS ? process.env.EXTRA_ARGS.split(' ') : [])],
            // REAL_BACKGROUND=1 (with HEADED=1): background tabs hidden and throttled as in a user's Chrome.
            ...(process.env.REAL_BACKGROUND ? { ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] } : {}),
        });
        // Corpus pages point at their real sites (`<base>`): images and fonts would load from the
        // internet. Tests stay offline: only the local server, the extension and inline data load.
        await context.route(url => !/^(https?:\/\/127\.0\.0\.1[:/]|chrome-extension:|data:|blob:|about:)/.test(url.href), route => route.abort());
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
    // Each test leaves the browser as it found it (#58): the pages it opened are closed (a live page or
    // a scroll run left open slows every later test until they time out), and a next-button run's
    // saved state is removed (a later test's page on the same server would resume it).
    panel: async ({ ext, extensionId }, use) => {
        const before = new Set(ext.pages());
        const panel = await Panel.open(ext, extensionId);
        await use(panel);
        await panel.page.evaluate(() => chrome.storage.local.remove(['pagination_state', 'pagination_stopped_at'])).catch(() => undefined);
        // Background runs the test started and didn't wait for (list pages, details, bulk): stopped, not left
        // retrying behind every later test with their tabs closed.
        await Promise.all(['BULK_EXTRACTION_STOP', 'METADATA_EXTRACTION_STOP', 'CONTACTS_STOP', 'API_STOP']
            .map(type => panel.toExtension(type).catch(() => undefined)));
        await Promise.all(ext.pages().filter(p => !before.has(p)).map(p => p.close().catch(() => undefined)));
    },
});

export { expect } from '@playwright/test';
