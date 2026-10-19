/** Toolkit → Data on this page (docs/plans/automation-and-page-tools-plan.md §3.8, T3). */
import { test, expect } from './harness';

test('the page\'s data as a tree: search, select, copy path, Use in AI Extract', async ({ ext, origin, panel }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/assistant-product.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=toolkit&tool=data&tabId=${tabId}`);

    const tree = ui.getByTestId('data-tree');
    await expect(tree).toContainText('JSON-LD · Product');
    // A Product with no image, aggregateRating or sku: recommended, not a problem.
    await expect(ui.getByText(/Recommended but missing: Product: no image/)).toBeVisible();

    await ui.getByLabel('Search the data').fill('price');
    await expect(ui.getByTestId('data-hits')).toHaveText('2 matches');
    await expect(tree).toContainText('"158.89"');

    await tree.getByRole('treeitem').filter({ hasText: 'price:' }).first().click();
    await expect(ui.getByTestId('data-path')).toHaveText('offers.price');

    // The whole Product: AI Extract opens with its schema, and page data answers it.
    await ui.getByLabel('Search the data').fill('');
    await tree.getByRole('treeitem').filter({ hasText: 'Product' }).first().click();
    await ui.getByRole('button', { name: 'Use in AI Extract' }).click();
    const schema = ui.getByRole('textbox').first();
    await expect(schema).toHaveValue(/^name: e\.g\. Trailblazer 24V Kids ATV\nbrand\.name: e\.g\. Yexmas\noffers\.price: e\.g\. 158\.89\noffers\.priceCurrency: e\.g\. USD$/);
    await ui.close();
    await page.close();
});
