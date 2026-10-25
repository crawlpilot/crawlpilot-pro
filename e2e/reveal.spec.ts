/**
 * Hidden sections are read before a page becomes markdown (docs/plans/ai-extract-v2-plan.md §3.1a),
 * for AI Extract's page view and the metadata extractor. Clicking to reveal is switched off for now
 * (`CLICK_TO_REVEAL`): sections already in the page behind a control are read, nothing is clicked,
 * hidden text with no control stays out, and the page is left exactly as it was.
 */
import { test, expect } from './harness';

/** In the page behind a control: read with no click. */
const IN_PAGE = [
    '180 cm',                                   // Bootstrap collapse
    'Solid European oak',                       // ARIA accordion, in the page
    'Wipe clean with a damp cloth',             // Radix-style region
    'Ships in 2 days',                          // inactive tab, in the page
    'FSC certified oak',                        // line-clamped text
];
/** Built only when clicked: clicking to reveal is switched off for now (CLICK_TO_REVEAL), so not read. */
const CLICK_ONLY = [
    'Ten year warranty',                        // lazy accordion
    'Lovely sturdy table',                      // lazy tab (built when selected)
];

test('AI page view: hidden sections in the page are read, nothing is clicked, the page is untouched', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/hidden-sections.html`);
    const tabId = await panel.tabId(page.url());
    const reply = await panel.toTab(tabId, 'AI_PAGE_VIEW', { chunkChars: 50_000, maxChunks: 4 });
    expect(reply.success).toBe(true);
    const text = reply.view.chunks.join('\n');
    for (const fact of IN_PAGE) expect(text, fact).toContain(fact);
    for (const fact of CLICK_ONLY) expect(text, fact).not.toContain(fact);
    expect(text).not.toContain('SECRET-HIDDEN-TEXT');
    expect(text).not.toContain('Home Shop About');

    const r = reply.view.revealed;
    expect(r.read).toEqual(expect.arrayContaining(['Specifications', 'Materials', 'Care', 'Shipping']));
    expect(r).toMatchObject({ opened: [], tabs: [], clicks: 0 });
    // Each block read from a hidden section is tagged with it (the evidence's "from Materials").
    expect(Object.values(reply.view.sections)).toEqual(expect.arrayContaining(['Specifications', 'Materials', 'Care', 'Shipping']));

    // Nothing clicked: nothing bought, no filter touched, still on the page, Overview still selected.
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

test('metadata extractor (the bulk runs\' handler): hidden sections in the page are in the markdown, and the row says which', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/hidden-sections.html`);
    const tabId = await panel.tabId(page.url());
    const reply = await panel.toTab(tabId, 'CMD_EXTRACT_METADATA', { url: page.url(), options: { favorRecall: true } });
    expect(reply.success).toBe(true);
    for (const fact of ['Solid European oak', 'Ships in 2 days']) expect(reply.result.markdown, fact).toContain(fact);
    for (const fact of CLICK_ONLY) expect(reply.result.markdown, fact).not.toContain(fact);
    expect(reply.result.markdown).not.toContain('SECRET-HIDDEN-TEXT');
    expect(reply.result.revealed).toMatch(/Specifications/);
    expect(await page.evaluate(() => ({ ...document.body.dataset }))).toEqual({});

    const off = await panel.toTab(tabId, 'CMD_EXTRACT_METADATA', { url: page.url(), options: { favorRecall: true, reveal: 'off' } });
    expect(off.result.markdown).not.toContain('Solid European oak');
    expect(off.result.revealed).toBe('');
    await page.close();
});

test('reading a page never leaves it: no button is clicked, even one that opens a section', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    const url = `${origin}/site/reveal-navigates.html`;
    await page.goto(url);
    const tabId = await panel.tabId(page.url());
    const reply = await panel.toTab(tabId, 'AI_PAGE_VIEW', { chunkChars: 50_000, maxChunks: 4 });
    expect(reply.success).toBe(true);
    expect(reply.view.chunks.join('\n')).not.toContain('Battery: 2 x AAA');
    expect(reply.view.revealed.clicks).toBe(0);
    await page.waitForTimeout(1500);
    expect(page.url()).toBe(url);
    expect(await page.title()).toBe('Reveal must not navigate');
    await page.close();
});
