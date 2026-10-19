/**
 * The Image Downloader's scan in a real browser (`e2e/site/gallery.html`): what a quick read finds,
 * what only the deep scan finds (lazy images and an infinite feed inside a scrolling `div`), sizes
 * measured after the scan, and the page's scroll put back. Then a save through the real UI
 * (`e2e/site/downloads.html`): the zip on disk, and the failures explained.
 */
import { test, expect, type Panel } from './harness';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import { unzipSync } from 'fflate';
import { sniffType } from '../src/shared/images/sniff';
import { imageDimensions } from '../src/shared/images/dimensions';

const path = (src: string) => src.startsWith('http') ? new URL(src).pathname + new URL(src).search : src.slice(0, 22);

async function open(panel: Panel, page: Page, origin: string) {
    await page.goto(`${origin}/site/gallery.html`);
    // The blob image and the shadow root are made by page scripts.
    await page.waitForFunction(() => (document.getElementById('blob') as HTMLImageElement).src.startsWith('blob:'));
    return panel.tabId(page.url());
}

test('quick scan: every kind of image on the page, without scrolling', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    const tabId = await open(panel, page, origin);
    const reply = await panel.toTab(tabId, 'SCAN_IMAGES');
    expect(reply.success).toBe(true);
    const images: any[] = reply.images;
    const by = Object.fromEntries(images.map(i => [path(i.src), i]));

    for (const p of [
        '/img/og-1200x630.jpg', '/img/resp-1600x1067.jpg', '/img/thumb-200x150.jpg', '/img/bg-640x480.jpg',
        '/img/set2-400x400.png', '/img/badge-64x64.png', '/cdn/photo?id=7&w=500&h=500', '/img/slide1-800x600.jpg',
        '/img/slide2-800x600.jpg', '/img/shadow-320x240.png', '/img/framed-300x300.png',
    ]) expect(by[p], p).toBeTruthy();

    // The widest srcset entry, with the shown one as a variant.
    expect(by['/img/resp-1600x1067.jpg'].variants.map(path)).toContain('/img/resp-300x200.jpg');
    expect(by['/img/resp-1600x1067.jpg'].width).toBe(1600);
    // The full-size original behind a thumbnail.
    expect(path(by['/img/thumb-200x150.jpg'].linked)).toBe('/img/full-2000x1500.jpg');
    // image-set: the densest; the other a variant, not a second image.
    expect(by['/img/set1-200x200.png']).toBeUndefined();
    // Hidden carousel slide: kept, marked.
    expect(by['/img/slide2-800x600.jpg'].hidden).toBe(true);
    expect(by['/img/slide1-800x600.jpg'].hidden).toBe(false);
    expect(images.some(i => i.origin === 'svg' && i.width === 120)).toBe(true);
    expect(images.some(i => i.src.startsWith('blob:'))).toBe(true);
    // Lazy images below the fold haven't loaded: only scrolling finds them (the first is on screen).
    expect(images.filter(i => /lazy\d/.test(i.src)).map(i => path(i.src))).toEqual(['/img/lazy1-900x600.jpg']);

    // Sizes the markup doesn't give arrive afterwards: the background's file, not its 50px box.
    await expect.poll(async () => (await panel.received('SCAN_IMAGES_BATCH'))
        .flatMap(b => b.updated).find((i: any) => i.src.endsWith('/img/bg-640x480.jpg'))?.width, { timeout: 10_000 }).toBe(640);
    await page.close();
});

test('deep scan: scrolls the feed div, finds lazy and appended images, puts the scroll back', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    const tabId = await open(panel, page, origin);
    await panel.toTab(tabId, 'SCAN_IMAGES');
    await panel.clear();

    const reply = await panel.toTab(tabId, 'SCAN_IMAGES_DEEP');
    expect(reply.success).toBe(true);
    const found = reply.images.map((i: any) => path(i.src));
    for (const p of ['/img/lazy1-900x600.jpg', '/img/lazy2-900x600.jpg', '/img/lazy3-900x600.jpg', '/img/more11-700x700.jpg', '/img/more22-700x700.jpg']) {
        expect(found, p).toContain(p);
    }
    // Streamed while scrolling, not only in the reply.
    const streamed = (await panel.received('SCAN_IMAGES_BATCH')).flatMap(b => b.added).map((i: any) => path(i.src));
    expect(streamed).toContain('/img/lazy2-900x600.jpg');
    const progress = await panel.received('SCAN_IMAGES_PROGRESS');
    expect(progress.at(-1)).toMatchObject({ phase: 'complete', percent: 100 });

    expect(await page.evaluate(() => document.getElementById('feed')!.scrollTop)).toBe(0);
    await page.close();
});

test('quick scan on a large retail page: the product images, in under 2 seconds', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/corpus/amazon-search`);
    const tabId = await panel.tabId(page.url());
    const started = Date.now();
    const reply = await panel.toTab(tabId, 'SCAN_IMAGES');
    const took = Date.now() - started;
    const products = await page.evaluate(() => document.querySelectorAll('[data-component-type="s-search-result"] img.s-image').length);
    const found = reply.images.filter((i: any) => i.src.includes('m.media-amazon.com/images/I/')).length;
    console.log(`amazon-search: ${reply.images.length} images (${found} product) in ${took} ms; ${products} product cards`);
    expect(found).toBeGreaterThanOrEqual(products);
    expect(took).toBeLessThan(2000);
    await page.close();
});

test('save as zip from the UI: protected, login-only and blob images saved, failures explained', async ({ panel, ext, origin, extensionId }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/downloads.html`);
    await page.waitForFunction(() => (document.getElementById('blob') as HTMLImageElement).src.startsWith('blob:'));
    const tabId = await panel.tabId(page.url());

    const ui = await ext.newPage();
    await ui.goto(`chrome-extension://${extensionId}/sidepanel.html?view=image-downloader&tabId=${tabId}`);
    await ui.evaluate(() => { localStorage.setItem('crawlpilot.images.mode', 'zip'); localStorage.setItem('crawlpilot.images.template', '{name}'); });
    await ui.reload();
    await ui.getByRole('button', { name: /Download All \(7\)/ }).click({ timeout: 10_000 });
    await expect(ui.getByText(/Saved 5 of 7/)).toBeVisible({ timeout: 30_000 });
    await ui.getByRole('button', { name: 'Why' }).click();
    await expect(ui.getByText(/Gone from the server \(404\) · 1/)).toBeVisible();
    await expect(ui.getByText(/Not an image .* · 1/)).toBeVisible();

    const [zip] = await ui.evaluate(() => chrome.downloads.search({ mime: 'application/zip', state: 'complete' }));
    const entries = unzipSync(new Uint8Array(fs.readFileSync(zip.filename)));
    expect(Object.keys(entries).sort()).toEqual(['image.png', 'image.svg', 'plain-400x300.png', 'private-320x200.png', 'protected-500x500.png']);
    expect(sniffType(entries['protected-500x500.png'])).toBe('image/png');
    await ui.close();
    await page.close();
});

test('full size: the linked original and a WordPress original are found, shown and saved', async ({ panel, ext, origin, extensionId }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/fullsize.html`);
    const tabId = await panel.tabId(page.url());

    const ui = await ext.newPage();
    await ui.goto(`chrome-extension://${extensionId}/sidepanel.html?view=image-downloader&tabId=${tabId}`);
    await ui.evaluate(() => { localStorage.setItem('crawlpilot.images.mode', 'zip'); localStorage.setItem('crawlpilot.images.template', '{name}-{width}x{height}'); });
    await ui.reload();
    // Two HD badges: the third image has no larger original.
    await expect(ui.getByText('HD', { exact: true })).toHaveCount(2, { timeout: 15_000 });
    await expect(ui.getByText('2000×1500')).toBeVisible();
    await expect(ui.getByText('2400×1600')).toBeVisible();

    await ui.getByRole('button', { name: /Download All \(3\)/ }).click();
    await expect(ui.getByText(/Saved 3 of 3/)).toBeVisible({ timeout: 30_000 });
    const zips = await ui.evaluate(() => chrome.downloads.search({ mime: 'application/zip', state: 'complete', orderBy: ['-startTime'] }));
    const entries = unzipSync(new Uint8Array(fs.readFileSync(zips[0].filename)));
    expect(Object.keys(entries).sort()).toEqual(['alone-400x400-400x400.png', 'original-2000x1500-2000x1500.png', 'photo-2400x1600.png']);
    expect(imageDimensions(entries['photo-2400x1600.png'])).toEqual({ width: 2400, height: 1600 });
    await ui.close();
    await page.close();
});

test('panel: range select, preview and show on page, filters kept per site, save to Data, manifest in the zip', async ({ panel, ext, origin, extensionId }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/downloads.html`);
    await page.waitForFunction(() => (document.getElementById('blob') as HTMLImageElement).src.startsWith('blob:'));
    const tabId = await panel.tabId(page.url());
    const ui = await ext.newPage();
    const open = () => ui.goto(`chrome-extension://${extensionId}/sidepanel.html?view=image-downloader&tabId=${tabId}`);
    await open();
    const cards = ui.getByRole('checkbox');
    await expect(cards).toHaveCount(7, { timeout: 10_000 });

    // Shift-click selects the range.
    await cards.nth(1).click();
    await cards.nth(4).click({ modifiers: ['Shift'] });
    await expect(ui.getByText('selected')).toBeVisible();
    await expect(cards.and(ui.locator('[aria-checked="true"]'))).toHaveCount(4);

    // Preview the first image and show it on the page: the page scrolls to it and outlines it.
    await cards.nth(0).dblclick();
    await expect(ui.getByText('Image 1 of 7')).toBeVisible();
    await ui.getByRole('button', { name: 'Show on page' }).click();
    await expect(ui.getByText('Shown on the page')).toBeVisible();
    await expect.poll(() => page.evaluate(() => [...document.documentElement.children].some(e => e.tagName === 'DIV' && (e as HTMLElement).style.border.includes('solid')))).toBe(true);
    await ui.keyboard.press('Escape');

    // Save the selection to Data: a table with one row per image.
    const tablePage = ext.waitForEvent('page');
    await ui.getByRole('button', { name: 'Save the list to Data' }).click();
    await (await tablePage).waitForLoadState();
    const tables = await panel.store('tables');
    const table = tables.find((t: any) => t.source === 'images');
    expect(table?.rowCount).toBe(4);

    // Filters are kept for the site: drop PNG, reopen, still dropped.
    await ui.getByRole('button', { name: 'Filters' }).click();
    await ui.getByRole('button', { name: 'png', exact: true }).click();
    // Left: the SVG, and the blob: image (its URL doesn't say its type, and unknown types pass).
    await expect(cards).toHaveCount(2);
    await open();
    await expect(cards).toHaveCount(2, { timeout: 10_000 });
    await ui.getByRole('button', { name: 'Filters' }).click();
    await ui.getByRole('button', { name: 'Reset filters' }).first().click();
    await expect(cards).toHaveCount(7);

    // A zip with its manifest.
    await ui.evaluate(() => { localStorage.setItem('crawlpilot.images.mode', 'zip'); localStorage.setItem('crawlpilot.images.template', '{name}'); localStorage.setItem('crawlpilot.images.manifest', 'on'); });
    await open();
    await ui.getByRole('button', { name: /Download All \(7\)/ }).click({ timeout: 10_000 });
    await expect(ui.getByText(/Saved 5 of 7/)).toBeVisible({ timeout: 30_000 });
    const zips = await ui.evaluate(() => chrome.downloads.search({ mime: 'application/zip', state: 'complete', orderBy: ['-startTime'] }));
    const entries = unzipSync(new Uint8Array(fs.readFileSync(zips[0].filename)));
    const csv = new TextDecoder().decode(entries['manifest.csv']).trim().split('\r\n');
    expect(csv[0]).toBe('file,url,shown_url,page,alt,caption,section,width,height,type,bytes');
    expect(csv).toHaveLength(6);
    expect(csv.find(r => r.startsWith('protected-500x500.png'))).toContain(',Protected,');
    await ui.close();
    await page.close();
});

test('duplicates folded (URL variants, then look-alikes by pixels); converted to JPG at most 512 px', async ({ panel, ext, origin, extensionId }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/dupes.html`);
    const tabId = await panel.tabId(page.url());
    const ui = await ext.newPage();
    await ui.goto(`chrome-extension://${extensionId}/sidepanel.html?view=image-downloader&tabId=${tabId}`);
    await ui.evaluate(() => {
        localStorage.setItem('crawlpilot.images.mode', 'zip');
        localStorage.setItem('crawlpilot.images.template', '{alt}');
        localStorage.setItem('crawlpilot.images.manifest', 'off');
        localStorage.setItem('crawlpilot.images.processing', JSON.stringify({ format: 'jpeg', quality: 0.85, maxSide: 512 }));
    });
    await ui.reload();
    const cards = ui.getByRole('checkbox');
    // 5 images; the two sizes of /cdn/photo?id=9 fold into the larger.
    await expect(cards).toHaveCount(4, { timeout: 10_000 });
    await expect(ui.getByText(/1 duplicates folded/)).toBeVisible();

    await ui.getByRole('button', { name: 'More' }).click();
    await ui.getByRole('menuitem', { name: /Find look-alikes/ }).click();
    await expect(cards).toHaveCount(3, { timeout: 15_000 });
    await expect(ui.getByText(/2 duplicates folded/)).toBeVisible();

    await ui.getByRole('button', { name: /Download All \(3\)/ }).click();
    await expect(ui.getByText(/Saved 3 of 3/)).toBeVisible({ timeout: 30_000 });
    await expect(ui.getByText(/3 converted or resized/)).toBeVisible();
    const zips = await ui.evaluate(() => chrome.downloads.search({ mime: 'application/zip', state: 'complete', orderBy: ['-startTime'] }));
    const entries = unzipSync(new Uint8Array(fs.readFileSync(zips[0].filename)));
    // The larger of each pair kept: Large (1200×800) and Kitty (600×400), then resized to 512 at most.
    expect(Object.keys(entries).sort()).toEqual(['Dog.jpg', 'Kitty.jpg', 'Large.jpg']);
    for (const [name, bytes] of Object.entries(entries)) {
        expect(sniffType(bytes), name).toBe('image/jpeg');
        const size = imageDimensions(bytes)!;
        expect(Math.max(size.width, size.height), name).toBe(512);
    }
    // The profile is shared: later saves shouldn't convert.
    await ui.evaluate(() => localStorage.removeItem('crawlpilot.images.processing'));
    await ui.close();
    await page.close();
});
