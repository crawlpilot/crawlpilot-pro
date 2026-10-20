/**
 * Virtual lists (docs/plans/virtual-feeds-plan.md V0–V1): a run reads every item once, with its own
 * content, though only the items near the viewport are in the page and their nodes come and go.
 */
import { test, expect, pickList } from './harness';

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

test('a pick on an Instagram profile: the 12 posts, by what they link to, with no load-numbered ids', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${origin}/corpus/instagram-profile`);
    const sel = await pickList(panel, page, 'main a[href*="/p/"] img');
    expect(sel.count).toBe(12);
    expect(sel.items).toContain('div:has(> a[href*="/reel/"], > a[href*="/p/"])');
    expect(sel.container.join(' ')).not.toMatch(/mount_|nth-/);
    // The markup has only the link: the caption and kind of each post come from the page's JSON.
    const names = (sel.data.columns as { id: string; name: string }[]).map(c => c.name);
    console.log('IG FIELDS', JSON.stringify(names), JSON.stringify(sel.data.items[0]).slice(0, 600));
    const caption = (sel.data.columns as { id: string; name: string }[]).find(c => c.name === 'Caption Text')!;
    expect(caption).toBeTruthy();
    expect((sel.data.items as Record<string, string>[]).filter(r => r[caption.id]?.length > 20)).toHaveLength(12);
});

test('picked on the windowed grid, then run with the picked chains: every post once', async ({ panel, ext, origin }) => {
    test.setTimeout(200_000);
    const page = await ext.newPage();
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(`${origin}/site/virtual-grid.html?total=48`);
    await page.waitForTimeout(800);
    const sel = await pickList(panel, page, '.x1cell img');
    expect(sel.container.join(' ')).not.toMatch(/mount_/);
    const tabId = await panel.tabId(page.url());
    await panel.clear();
    await panel.toTab(tabId, 'EXECUTE_AUTO_SCROLL', { container: sel.container, items: sel.items, enableInfiniteScroll: true, scrollDelay: 50, contentLoadDelay: 1500, columns: sel.data?.columns });
    const done = await panel.next('AUTO_SCROLL_COMPLETE', 170_000);
    const codes = (done.items as Record<string, unknown>[]).map(r => /\/(?:p|reel)\/(C\w+x)\//.exec(values(r))?.[1]);
    expect(codes).toEqual(Array.from({ length: 48 }, (_, i) => code(i + 1)));
});

test('fields the markup doesn\'t show come from the page\'s data: the bootstrap JSON, then the API pages the scroll fetched', async ({ panel, ext, origin }) => {
    test.setTimeout(200_000);
    const page = await ext.newPage();
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(`${origin}/site/virtual-grid.html?total=36`);
    await page.waitForTimeout(800);
    const sel = await pickList(panel, page, '.x1cell img');
    const columns = sel.data.columns as { id: string; name: string; type: string }[];
    const caption = columns.find(c => c.name === 'Caption Text')!;
    const taken = columns.find(c => c.name === 'Taken At')!;
    expect(caption).toBeTruthy();
    expect(taken.type).toBe('date');
    const tabId = await panel.tabId(page.url());
    await panel.clear();
    await panel.toTab(tabId, 'EXECUTE_AUTO_SCROLL', { container: sel.container, items: sel.items, enableInfiniteScroll: true, scrollDelay: 50, contentLoadDelay: 1500, columns: sel.data.columns });
    const done = await panel.next('AUTO_SCROLL_COMPLETE', 170_000);
    const rows = done.items as Record<string, string>[];
    expect(rows).toHaveLength(36);
    rows.forEach((r, i) => {
        // Each post's own caption and time, also for posts 13–36 that only the API pages had.
        expect(r[caption.id], `row ${i + 1}`).toBe(`Post ${i + 1}: a day at the coast #${i + 1}`);
        expect(r[taken.id], `row ${i + 1}`).toBe(new Date((1790000000 + (i + 1) * 3600) * 1000).toISOString());
    });
});
