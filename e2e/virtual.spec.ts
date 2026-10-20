/**
 * Virtual lists (docs/plans/virtual-feeds-plan.md V0–V1): a run reads every item once, with its own
 * content, though only the items near the viewport are in the page and their nodes come and go.
 */
import { test, expect } from './harness';

const code = (n: number) => `C${n.toString(36).padStart(4, '0')}x`;
const values = (row: Record<string, unknown>) => Object.values(row).map(String).join(' ');

async function run(panel: any, ext: any, url: string, container: string[], items: string[], limits: { maxItems?: number } = {}) {
    const page = await ext.newPage();
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(url);
    await page.waitForTimeout(1000);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    await panel.clear();
    await panel.toTab(tabId, 'EXECUTE_AUTO_SCROLL', { container, items, enableInfiniteScroll: true, scrollDelay: 50, contentLoadDelay: 1500, ...limits });
    const done = await panel.next('AUTO_SCROLL_COMPLETE', 170_000);
    expect(done.success).toBe(true);
    return done.items as Record<string, unknown>[];
}

test('a windowed grid split into rows: every post once, in order, though rows unmount and the wrapper is replaced', async ({ panel, ext, origin }) => {
    test.setTimeout(200_000);
    const rows = await run(panel, ext, `${origin}/site/virtual-grid.html`, ['main section > .x9grid > div'], ['.x1row > .x1cell']);
    const codes = rows.map(r => /\/(?:p|reel)\/(C\w+x)\//.exec(values(r))?.[1]);
    expect(codes).toEqual(Array.from({ length: 120 }, (_, i) => code(i + 1)));
});

test('an endless feed ends at the run\'s limit, with the rows read so far', async ({ panel, ext, origin }) => {
    test.setTimeout(120_000);
    const rows = await run(panel, ext, `${origin}/site/virtual-feed.html?total=0`, ['.x1feed'], ['article'], { maxItems: 25 });
    expect(rows.map(r => Number(/Post (\d+):/.exec(values(r))?.[1]))).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
});

test('a feed whose article nodes are recycled: every post once, each with its own caption and link', async ({ panel, ext, origin }) => {
    test.setTimeout(200_000);
    const rows = await run(panel, ext, `${origin}/site/virtual-feed.html?total=40`, ['.x1feed'], ['article']);
    const posts = rows.map(r => Number(/Post (\d+):/.exec(values(r))?.[1]));
    expect(posts).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    // Each row's link is its own post's (none mixed from the post the node showed before).
    for (const [i, r] of rows.entries()) {
        const link = /\/p\/(C\w+x)\//.exec(values(r))?.[1];
        if (link) expect(link).toBe(code(i + 1));
    }
});
