/** Runs on a struggling computer (`docs/plans/performance-plan.md` P4). */
import { test, expect } from './harness';

test('a run goes on with fewer tabs when pages open far slower than its first ones', async ({ panel, origin }) => {
    test.setTimeout(120_000);
    // The first three pages set this computer's normal; the next ones take 16 s to arrive.
    const urls = [1, 2, 3, 4, 5, 6].map(n => `${origin}/site/product.html?id=${n}${n > 3 ? '&delay=16000' : ''}`);
    const elements = [{ id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1'] }];
    await panel.clear();
    const start = await panel.toExtension('BULK_EXTRACTION_START', { urls, elements, config: { requestDelay: 0 }, maxConcurrent: 3, customName: 'e2e ease' });
    expect(start?.success).toBe(true);
    const done = await panel.next('BULK_EXTRACTION_COMPLETE', 100_000);
    expect(done.success).toBe(true);
    const job = (await panel.store('jobs')).find(j => j.id === done.jobId);
    expect(job.stats.pagesVisited).toBe(6);
    expect(job.stats.eased).toMatchObject({ to: 2 });
    expect(job.stats.eased.reason).toMatch(/took \d+ s to open/);
});

test('progress messages are spaced out, and the last one before "complete" is final', async ({ panel, origin }) => {
    const urls = Array.from({ length: 8 }, (_, n) => `${origin}/site/product.html?id=p${n}`);
    const elements = [{ id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1'] }];
    await panel.clear();
    await panel.page.evaluate(() => {
        (window as any).__times = [];
        chrome.runtime.onMessage.addListener((m: any) => { if (m.type === 'BULK_EXTRACTION_PROGRESS') (window as any).__times.push(Date.now()); });
    });
    const start = await panel.toExtension('BULK_EXTRACTION_START', { urls, elements, config: { requestDelay: 0 }, maxConcurrent: 3 });
    expect(start?.success).toBe(true);
    await panel.next('BULK_EXTRACTION_COMPLETE', 60_000);
    const progress = await panel.received('BULK_EXTRACTION_PROGRESS');
    const last = progress[progress.length - 1];
    expect(last.completedUrls).toBe(8);
    const times: number[] = await panel.page.evaluate(() => (window as any).__times);
    // At most one per 250 ms, plus the first and the final one (arrival times jitter, so count them).
    const span = times[times.length - 1] - times[0];
    expect(times.length).toBeLessThanOrEqual(Math.ceil(span / 250) + 2);
});
