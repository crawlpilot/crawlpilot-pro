/**
 * API recipes (docs/plans/api-recipes-plan.md): a call the API Finder recorded, run again page by page
 * from the site's page with its session cookie, against the test server's fake shop API.
 */
import { test, expect } from './harness';
import { guessPaging, toRequest, type ApiSpec } from '../src/shared/network/apiRecipe';
import type { NetEntry } from '../src/shared/network/types';

function entry(url: string, body?: unknown): NetEntry {
    return {
        seq: 1, url, method: body ? 'POST' : 'GET', status: 200, contentType: 'application/json',
        requestHeaders: { 'content-type': 'application/json' }, requestBody: body ? JSON.stringify(body) : undefined,
        responseText: '', size: 0, truncated: false, at: 0, via: 'fetch',
    };
}

test('API Finder: record, find a value, get every page of its list', async ({ ext, origin, panel }) => {
    await panel.clear();
    const page = await ext.newPage();
    await page.goto(`${origin}/site/api-shop.html`);
    await expect(page.getByText('lamp 3 ·')).toBeVisible();
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=toolkit&tool=api&tabId=${tabId}`);

    await ui.getByRole('button', { name: 'Reload & record' }).click();
    await expect(ui.getByText(/Recording · \d+ JSON response/)).toContainText('2 JSON responses', { timeout: 15_000 });
    await ui.getByRole('button', { name: 'Stop' }).click();
    await ui.getByLabel('Value to find').fill('lamp 3');

    // The first page's call leaves `page` out; the response's totalPages says it pages.
    await expect(ui.getByLabel('How it pages')).toContainText('Page number: page=1, 2');
    if (process.env.API_SHOTS) await ui.screenshot({ path: `${process.env.API_SHOTS}/api-run.png`, fullPage: true });
    await ui.getByRole('button', { name: 'Start', exact: true }).click();
    const run = ui.getByTestId('api-run');
    await expect(run).toContainText('Done', { timeout: 30_000 });
    await expect(ui.getByTestId('api-run-rows')).toHaveText('30 rows');
    if (process.env.API_SHOTS) await ui.screenshot({ path: `${process.env.API_SHOTS}/api-done.png`, fullPage: true });

    const done = (await panel.store('jobs')).at(-1);
    const rows = (await panel.store('rows')).filter(r => r.tableId === done.tableId).map(r => r.data);
    expect(rows.map(r => r.title)).toEqual(Array.from({ length: 30 }, (_, i) => `lamp ${i + 1}`));
    expect(rows[0]['price.value']).toBe(10);
    await ui.close();
    await page.close();
});

test('a cursor in a POST body, and one series of pages per value', async ({ ext, origin, panel }) => {
    await panel.clear();
    const page = await ext.newPage();
    await page.goto(`${origin}/site/api-shop.html`);
    await expect(page.getByText('Gadget 3')).toBeVisible();

    // GraphQL-style: the response's endCursor goes back in the body's `after`.
    const gql = entry(`${origin}/api/graphql`, { query: '{catalog}', variables: { first: 10, after: '' } });
    const items = ['data', 'catalog', 'edges'];
    const first = { data: { catalog: { edges: [{}], pageInfo: { hasNextPage: true, endCursor: '10' } } } };
    const cursor: ApiSpec = { kind: 'api', request: toRequest(gql), page: page.url(), items, paging: guessPaging(gql, first, items), maxPages: 50 };
    expect(cursor.paging.mode).toBe('cursor');
    expect((await panel.toExtension('API_START', { spec: cursor, customName: 'e2e gql' }))?.success).toBe(true);
    let done = await panel.next('API_COMPLETE', 60_000);
    expect(done).toMatchObject({ success: true, totalItems: 25 });
    let rows = (await panel.store('rows')).filter(r => r.tableId === done.tableId).map(r => r.data);
    expect(rows.map(r => r['node.sku'])).toEqual(Array.from({ length: 25 }, (_, i) => `G${i + 1}`));

    // A query parameter run for each value: a column says which value each row came from.
    const search = entry(`${origin}/api/products?q=lamp&page=1`);
    const spec: ApiSpec = {
        kind: 'api', request: toRequest(search), page: page.url(), items: ['products'],
        paging: guessPaging(search, { products: [{}] }, ['products']), input: { where: 'query', name: 'q', value: 'lamp' }, maxPages: 2,
    };
    await panel.clear();
    expect((await panel.toExtension('API_START', { spec, values: ['desk', 'chair'], customName: 'e2e values' }))?.success).toBe(true);
    done = await panel.next('API_COMPLETE', 60_000);
    expect(done).toMatchObject({ success: true, totalItems: 40 });
    rows = (await panel.store('rows')).filter(r => r.tableId === done.tableId).map(r => r.data);
    expect(rows.filter(r => r.q === 'chair')).toHaveLength(20);
    expect(rows.find(r => r.q === 'desk')?.title).toBe('desk 1');
    await page.close();
});

test('a refused call fails with plain words', async ({ origin, panel, ext }) => {
    await panel.clear();
    // A page of the site that never signed in: no session cookie.
    await ext.clearCookies();
    const search = entry(`${origin}/api/products?q=lamp&page=1`);
    const spec: ApiSpec = { kind: 'api', request: toRequest(search), page: `${origin}/site/list-1.html`, items: ['products'], paging: { mode: 'none' }, maxPages: 1 };
    expect((await panel.toExtension('API_START', { spec }))?.success).toBe(true);
    const done = await panel.next('API_COMPLETE', 60_000);
    expect(done.success).toBe(false);
    expect(done.error).toContain('The site refused the call (401)');
});
