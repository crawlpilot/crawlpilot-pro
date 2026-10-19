/**
 * No console errors from CrawlPilot in the pages it works on, its side panel or its service worker,
 * during a click pick and a bulk run with a click step. (A minified \`void chrome.runtime.lastError\`
 * was dropped as a no-op, and every broadcast nobody listened to logged "Unchecked runtime.lastError".)
 */
import { test, expect, pickElement } from './harness';

test('no console errors during a click pick and a bulk run with clicks', async ({ panel, ext, origin }) => {
    const seen: string[] = [];
    const watch = (p: any, where: string) => p.on('console', (m: any) => seen.push(`${where} [${m.type()}] ${m.text()}`));
    ext.pages().forEach((p, i) => watch(p, `page${i}`));
    ext.on('page', p => watch(p, 'new page'));
    ext.serviceWorkers().forEach(w => watch(w, 'worker'));
    ext.on('serviceworker', w => watch(w, 'worker'));

    const page = await ext.newPage();
    await page.goto(`${origin}/site/product.html?id=1`);
    await pickElement(panel, page, 'button.show-specs', 'click');
    await page.waitForTimeout(1000);

    const urls = [1, 2, 3].map(n => `${origin}/site/product-anim.html?id=${n}`);
    const elements = [
        { id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1'] },
        { id: 'open', name: 'Warranty', action: 'click', type: 'button', selectors: ['#toggle'] },
        { id: 'warranty', name: 'Warranty text', action: 'extract', type: 'text', selectors: ['p.warranty'] },
    ];
    await panel.clear();
    await panel.toExtension('BULK_EXTRACTION_START', { urls, elements, config: { requestDelay: 0, clickWaitMs: 500 }, maxConcurrent: 3, customName: 'console probe' });
    await panel.next('BULK_EXTRACTION_COMPLETE', 60_000);
    await page.waitForTimeout(1000);
    expect(seen.filter(s => /\[error\]|lastError|port closed/i.test(s))).toEqual([]);
});
