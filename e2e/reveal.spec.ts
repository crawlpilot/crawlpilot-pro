/**
 * Hidden sections are read before a page becomes markdown (docs/plans/ai-extract-v2-plan.md §3.1a):
 * closed accordions, inactive and lazy tabs, a lazy accordion and "Show more" text, for AI Extract's
 * page view and for the metadata extractor. Nothing that buys, signs in or leaves the page is clicked,
 * hidden text with no control stays out, and the page is put back afterwards.
 */
import { test, expect } from './harness';

const HIDDEN = [
    '180 cm',                                   // Bootstrap collapse
    'Solid European oak',                       // ARIA accordion, in the page
    'Wipe clean with a damp cloth',             // Radix-style region
    'Ten year warranty',                        // lazy accordion (needs a click)
    'Ships in 2 days',                          // inactive tab, in the page
    'Lovely sturdy table',                      // lazy tab (built when selected)
    'Hand finished in Portugal',                // "Show more"
    'FSC certified oak',                        // line-clamped text
];

test('AI page view: every hidden section is read, nothing unsafe clicked, page put back', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/hidden-sections.html`);
    const tabId = await panel.tabId(page.url());
    const reply = await panel.toTab(tabId, 'AI_PAGE_VIEW', { chunkChars: 50_000, maxChunks: 4 });
    expect(reply.success).toBe(true);
    const text = reply.view.chunks.join('\n');
    for (const fact of HIDDEN) expect(text, fact).toContain(fact);
    expect(text).not.toContain('SECRET-HIDDEN-TEXT');
    expect(text).not.toContain('Home Shop About');

    const r = reply.view.revealed;
    expect(r.read).toEqual(expect.arrayContaining(['Specifications', 'Materials', 'Care', 'Shipping']));
    expect(r.opened).toEqual(expect.arrayContaining(['Warranty', 'Show more']));
    expect(r.tabs).toEqual(['Reviews']);
    // A link to another page is never a candidate; the filter panel's "Show more" is skipped.
    expect(r.skipped).toEqual(expect.arrayContaining([{ label: 'Show more', reason: 'in a filter panel' }]));
    expect(r.stopped).toBeUndefined();
    // Each block read from a hidden section is tagged with it (the evidence's "from Materials"),
    // the captured lazy tab too: its blocks have refs, so values found there can be checked.
    expect(Object.values(reply.view.sections)).toEqual(expect.arrayContaining(['Specifications', 'Materials', 'Care', 'Shipping', 'Reviews']));
    const reviewsRef = text.match(/Lovely sturdy table[^\n]*\[(b\d+)\]/)?.[1];
    expect(reply.view.sections[reviewsRef!]).toBe('Reviews');

    // Nothing bought, no filter touched, still on the page; the warranty closed and Overview selected again.
    expect(await page.evaluate(() => ({ ...document.body.dataset }))).toEqual({});
    expect(page.url()).toContain('/site/hidden-sections.html');
    expect(await page.getAttribute('#warranty-btn', 'aria-expanded')).toBe('false');
    expect(await page.getAttribute('#t-overview', 'aria-selected')).toBe('true');
    await page.close();
});

test('AI page view with reveal off reads only what is shown', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/hidden-sections.html`);
    const tabId = await panel.tabId(page.url());
    const reply = await panel.toTab(tabId, 'AI_PAGE_VIEW', { chunkChars: 50_000, maxChunks: 4, reveal: 'off' });
    const text = reply.view.chunks.join('\n');
    expect(text).not.toContain('Solid European oak');
    expect(text).not.toContain('Ten year warranty');
    await page.close();
});

test('metadata extractor (the bulk runs\' handler): hidden sections are in the markdown, and the row says what was opened', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/hidden-sections.html`);
    const tabId = await panel.tabId(page.url());
    const reply = await panel.toTab(tabId, 'CMD_EXTRACT_METADATA', { url: page.url(), options: { favorRecall: true } });
    expect(reply.success).toBe(true);
    for (const fact of ['Solid European oak', 'Ten year warranty', 'Ships in 2 days', 'Lovely sturdy table']) expect(reply.result.markdown, fact).toContain(fact);
    expect(reply.result.markdown).not.toContain('SECRET-HIDDEN-TEXT');
    expect(reply.result.revealed).toMatch(/Specifications.*· 1 tab/);
    expect(await page.evaluate(() => ({ ...document.body.dataset }))).toEqual({});

    const off = await panel.toTab(tabId, 'CMD_EXTRACT_METADATA', { url: page.url(), options: { favorRecall: true, reveal: 'off' } });
    expect(off.result.markdown).not.toContain('Ten year warranty');
    expect(off.result.revealed).toBe('');
    await page.close();
});

test('reading a page never leaves it: a router push or a script navigation from a clicked button is cancelled', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    const url = `${origin}/site/reveal-navigates.html`;
    await page.goto(url);
    const tabId = await panel.tabId(page.url());
    const reply = await panel.toTab(tabId, 'AI_PAGE_VIEW', { chunkChars: 50_000, maxChunks: 4 });
    expect(reply.success).toBe(true);
    expect(reply.view.chunks.join('\n')).toContain('Battery: 2 x AAA');
    expect(reply.view.revealed.skipped).toContainEqual({ label: 'Show more', reason: 'tried to open another page' });
    await page.waitForTimeout(1500);
    expect(page.url()).toBe(url);
    expect(await page.title()).toBe('Reveal must not navigate');
    await page.close();
});
