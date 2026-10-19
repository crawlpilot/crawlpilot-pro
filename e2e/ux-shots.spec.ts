/**
 * Screenshots of every side-panel view at side-panel size (400 px wide) on a saved Walmart search
 * page, for reviewing the UI before and after a change (docs/plans/ux-simplification-plan.md §6).
 * Skipped unless UX_SHOTS=<dir> is set:
 *
 *   npm run build && UX_SHOTS=/tmp/ux npx playwright test e2e/ux-shots.spec.ts
 */
import { test } from './harness';

const DIR = process.env.UX_SHOTS;
const VIEWS = ['welcome', 'home', 'list-extractor', 'page-extractor', 'metadata-extractor', 'ai-extract', 'text-summarizer',
    'image-downloader', 'utilities', 'toolkit', 'history', 'settings'];

test('screenshots of every view', async ({ panel, ext, origin }) => {
    test.skip(!DIR, 'set UX_SHOTS=<dir> to take screenshots');
    test.setTimeout(180_000);
    const page = await ext.newPage();
    await page.goto(`${origin}/corpus/walmart-search`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    for (const view of VIEWS) {
        const ui = await ext.newPage();
        await ui.setViewportSize({ width: 400, height: 860 });
        await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=${view}&tabId=${tabId}`);
        await ui.waitForTimeout(1200);
        await ui.screenshot({ path: `${DIR}/${view}.png` });
        await ui.close();
    }
});
