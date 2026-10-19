/**
 * The Page assistant (docs/plans/summarize-ask-plan.md P1) on a product page. Playwright's Chromium
 * has no Gemini Nano, so the side panel gets a scripted `LanguageModel`: it briefs from the page view
 * it is given (real quotes of real blocks, plus one invented point) and answers with one sentence the
 * page supports and one it doesn't. Everything else is real: the page view, the claim checks, and the
 * highlight on the page.
 */
import { test, expect } from './harness';

function fakeModel() {
    const blocks = (text: string) => text.split('\n')
        .map(l => { const m = l.match(/^(.*?)\s*\[(b\d+)\]\s*$/); return m ? { text: m[1].replace(/^[#>*\-\s]+/, '').trim(), ref: m[2] } : null; })
        .filter((b): b is { text: string; ref: string } => !!b && b.text.split(' ').length >= 5);
    class FakeLM extends EventTarget {
        static async availability() { return 'available'; }
        static async create() { return new FakeLM(); }
        contextWindow = 9000;
        contextUsage = 100;
        page = '';
        async clone() { const c = new FakeLM(); c.page = this.page; return c; }
        async measureContextUsage(t: string, o?: any) { return Math.ceil((String(t).length + (o?.responseConstraint ? JSON.stringify(o.responseConstraint).length : 0)) / 4); }
        async append(msgs: any[]) { this.page += msgs.map(m => (typeof m.content === 'string' ? m.content : '')).join('\n'); }
        async prompt(text: string, opts?: any) {
            const schema = opts?.responseConstraint;
            if (schema?.type === 'array') return JSON.stringify(['Is it in stock?', 'How long does the battery last?', 'What age is it for?']);
            const list = blocks(text);
            const out: Record<string, unknown[]> = {};
            let i = 0;
            const quoted = Object.keys(schema.properties).filter(k => schema.properties[k].items?.properties?.quote);
            for (const key of Object.keys(schema.properties)) {
                const items: unknown[] = [];
                for (let k = 0; k < Math.min(schema.properties[key].maxItems ?? 1, 2) && i < list.length; k++, i++) {
                    const words = list[i].text.split(' ');
                    items.push(quoted.includes(key) ? { text: `About ${words.slice(0, 8).join(' ')}`, quote: words.slice(0, 7).join(' '), ref: list[i].ref } : { text: 'A reading of the page' });
                }
                out[key] = items;
            }
            // Invented: never on the page.
            const last = quoted[quoted.length - 1];
            out[last] = [...(out[last] ?? []).slice(0, 1), { text: 'It can drive over water', quote: 'drives over lakes and rivers with ease', ref: list[0].ref }];
            return JSON.stringify(out);
        }
        promptStreaming() {
            const list = blocks(this.page);
            const hit = list.find(b => /mph/.test(b.text)) ?? list[0];
            const answer = `The top speed is 3 mph [${hit.ref}]. It is also waterproof to 10 meters [${hit.ref}].`;
            return new ReadableStream({ start(c) { for (const part of answer.match(/.{1,12}/g)!) c.enqueue(part); c.close(); } });
        }
        destroy() { /* nothing held */ }
    }
    (self as any).LanguageModel = FakeLM;
}

test('a brief made for a product page: points checked on the page, shown with a click, answers cited', async ({ ext, origin, panel }) => {
    const product = await ext.newPage();
    await product.goto(`${origin}/site/assistant-product.html`);
    const tabId = await panel.tabId(product.url());
    await panel.toTab(tabId, 'PING');

    const ui = await ext.newPage();
    await ui.addInitScript(fakeModel);
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=text-summarizer&tabId=${tabId}`);

    const brief = ui.getByTestId('page-brief');
    await expect(brief).toBeVisible({ timeout: 20_000 });
    await expect(ui.getByText('Product', { exact: true })).toBeVisible();
    const points = brief.getByTestId('brief-point');
    await expect(points.first()).toBeVisible();
    const statuses = await points.evaluateAll(els => els.map(e => e.getAttribute('data-status')));
    expect(statuses.filter(s => s === 'verified').length).toBeGreaterThanOrEqual(4);
    // The invented point is marked, not presented as fact.
    await expect(brief.locator('[data-status="not_on_page"]')).toContainText('It can drive over water');
    await expect(brief).toContainText(/\d+ of \d+ points found on the page/);

    // Show on page: the quote is highlighted on the product page.
    const first = brief.locator('[data-status="verified"]').first();
    await first.click();
    await expect.poll(() => product.evaluate(() => {
        const h = (CSS as any).highlights?.get('crawlpilot-cite');
        return h ? [...h][0]?.toString() : '';
    })).not.toBe('');
    const highlighted = await product.evaluate(() => [...(CSS as any).highlights.get('crawlpilot-cite')][0].toString());
    expect(highlighted.split(' ').length).toBeGreaterThanOrEqual(5);

    // Ask: a cited answer; the sentence the page doesn't support is flagged.
    await ui.bringToFront();
    await ui.getByLabel('Ask about this page').fill('How fast does it go?');
    await ui.getByLabel('Ask about this page').press('Enter');
    const answer = ui.getByTestId('answer').last();
    await expect(answer).toContainText('The top speed is 3 mph');
    await expect(answer.getByTestId('cite').first()).toHaveAttribute('data-status', 'verified');
    // Each citation shows its own sentence's check: the waterproof claim's is not on the page.
    await expect(answer.getByTestId('cite').nth(1)).toHaveAttribute('data-status', 'not_on_page');
    await expect(answer).toContainText('1 sentence not found on the page');
    await expect(ui.getByTestId('suggestions')).toContainText('How long does the battery last?');

    // ASSISTANT_SHOT=<file.png>: the side panel as it looks now (for reviewing the UI).
    if (process.env.ASSISTANT_SHOT) await ui.screenshot({ path: process.env.ASSISTANT_SHOT, fullPage: true });

    // A citation in an answer shows its block on the page.
    await product.evaluate(() => (CSS as any).highlights.delete('crawlpilot-cite'));
    await answer.getByTestId('cite').first().click();
    await expect.poll(() => product.evaluate(() => [...((CSS as any).highlights?.get('crawlpilot-cite') ?? [])][0]?.toString() ?? '')).toContain('3 mph');
    await ui.close();
    await product.close();
});
