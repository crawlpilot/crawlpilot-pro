/**
 * The Image Downloader's scan in a real browser (`e2e/site/gallery.html`): what a quick read finds,
 * what only the deep scan finds (lazy images and an infinite feed inside a scrolling `div`), sizes
 * measured after the scan, and the page's scroll put back.
 */
import { test, expect, type Panel } from './harness';
import type { Page } from '@playwright/test';

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
