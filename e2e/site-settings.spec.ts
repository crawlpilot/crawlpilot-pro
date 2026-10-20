/**
 * Site settings: speed, page wait and walls set once per site, used by every run of it; a rate limit
 * makes a site Careful by itself.
 */
import { test, expect } from './harness';

const elements = [{ id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1'] }];

test('a site\'s settings set its runs\' pace; a rate limit makes it Careful', async ({ panel, origin }) => {
    test.setTimeout(120_000);
    // The test server's site: 1 tab at a time, no delay.
    await panel.page.evaluate(() => chrome.storage.local.set({ siteSettings: { '127.0.0.1': { pace: 'normal', delayMs: 0, tabs: 1 } } }));
    await panel.clear();
    const start = await panel.toExtension('BULK_EXTRACTION_START', { urls: [1, 2, 3].map(n => `${origin}/site/product.html?id=${n}`), elements, config: { requestDelay: 0 }, maxConcurrent: 3 });
    expect(start?.success).toBe(true);
    await panel.next('BULK_EXTRACTION_COMPLETE', 60_000);
    const job = (await panel.store('jobs')).find(j => j.id === start.jobId);
    expect(job.input.concurrency).toBe(1);

    // A page answers 429: the site goes Careful, marked as learned.
    await panel.page.evaluate(() => chrome.storage.local.remove('siteSettings'));
    await panel.clear();
    await panel.toExtension('BULK_EXTRACTION_START', { urls: [`${origin}/site/product.html?id=9&status=429`], elements, config: { requestDelay: 0 }, maxConcurrent: 1 });
    await expect.poll(async () => (await panel.page.evaluate(() => chrome.storage.local.get('siteSettings')) as any).siteSettings?.['127.0.0.1'], { timeout: 30_000 })
        .toMatchObject({ pace: 'careful', learned: { reason: expect.any(String) } });
    await panel.toExtension('BULK_EXTRACTION_STOP');
    await panel.page.evaluate(() => chrome.storage.local.remove('siteSettings'));
});
