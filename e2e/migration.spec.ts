/**
 * A version-5 database (what users have installed) upgraded by the real service worker in Chrome's
 * IndexedDB: recipes typed, jobs pointing at them, tables and rows moved to the v7 stores.
 */
import { test, expect, Panel } from './harness';

test('a v5 database migrates to v7 when the extension opens it, and My data shows the old run', async ({ ext, panel, extensionId }) => {
    // Replace the database with a v5 one. The extension's open connections close on `versionchange`.
    await panel.page.evaluate(async () => {
        await new Promise<void>((resolve, reject) => {
            const del = indexedDB.deleteDatabase('crawl-pilot');
            del.onsuccess = () => resolve();
            del.onerror = () => reject(del.error);
        });
        const db: IDBDatabase = await new Promise((resolve, reject) => {
            const open = indexedDB.open('crawl-pilot', 5);
            open.onupgradeneeded = () => {
                const d = open.result;
                const t = d.createObjectStore('tableData', { keyPath: 'id', autoIncrement: true });
                t.createIndex('name', 'name'); t.createIndex('createdAt', 'createdAt'); t.createIndex('automationId', 'automationId');
                const r = d.createObjectStore('tableRows', { keyPath: 'id', autoIncrement: true });
                r.createIndex('tableDataId', 'tableDataId'); r.createIndex('createdAt', 'createdAt');
                r.createIndex('tableData_dataHash', ['tableDataId', 'dataHash'], { unique: true });
                const rc = d.createObjectStore('recipes', { keyPath: 'id', autoIncrement: true });
                rc.createIndex('type', 'type'); rc.createIndex('createdAt', 'createdAt');
                const j = d.createObjectStore('jobs', { keyPath: 'id', autoIncrement: true });
                j.createIndex('recipeId', 'recipeId'); j.createIndex('status', 'status'); j.createIndex('sourceUrl', 'sourceUrl'); j.createIndex('createdAt', 'createdAt');
            };
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
        });
        const config = {
            type: 'list-extraction', selectors: ['.s-main-slot'],
            options: {
                pagination: { mode: 'pagination', nextButtonSelector: '.s-pagination-next', maxPages: 5 },
                fullSelectors: [{
                    id: 'sel-1', containerSelector: 'div > div:nth-of-type(2)',
                    containerSelectors: [{ selector: '.s-main-slot', strategy: 'Minimal' }],
                    itemSelector: '[data-index]', itemSelectors: [{ selector: 'div[data-component-type="s-search-result"]', strategy: 'Deductive CSS' }],
                    patternFound: true, count: 16, selectionMode: 'list',
                    data: { columns: [{ id: 'title', name: 'Title', type: 'text' }] },
                }],
            },
        };
        const tx = db.transaction(['recipes', 'jobs', 'tableData', 'tableRows'], 'readwrite');
        tx.objectStore('recipes').put({ id: 1, name: 'Laptops', type: 'list-extraction', version: 1, config, createdAt: 1, updatedAt: 1 });
        tx.objectStore('jobs').put({ id: 10, recipeId: 1, status: 'completed', sourceUrl: 'https://shop.test/s?k=laptop', configSnapshot: config, stats: { startTime: 1, itemsExtracted: 3 }, result: { tableDataId: 50 }, createdAt: 10, updatedAt: 10 });
        tx.objectStore('tableData').put({ id: 50, name: 'Laptops', columns: [{ id: 'title', name: 'Title', type: 'text' }], sourceUrl: 'u', createdAt: 1, updatedAt: 1, jobId: 10, metadata: { extractionType: 'list', isPreview: false } });
        const rows = tx.objectStore('tableRows');
        rows.add({ tableDataId: 50, data: { title: 'A', source_url: 'p1' }, dataHash: 'h1', createdAt: 1 });
        rows.add({ tableDataId: 50, data: { title: 'A', source_url: 'p2' }, dataHash: 'h2', createdAt: 2 });
        rows.add({ tableDataId: 50, data: { title: 'B', source_url: 'p2' }, dataHash: 'h3', createdAt: 3 });
        await new Promise(r => { tx.oncomplete = r; });
        db.close();
    });

    // A fresh side panel opens the database on the My data page and upgrades it (the service worker's
    // connection closed on the version change; whichever context opens it next runs the upgrade).
    const fresh = await Panel.open(ext, extensionId);
    await fresh.page.getByText('My data', { exact: true }).first().click();
    await fresh.page.waitForFunction(() => new Promise(resolve => {
        const open = indexedDB.open('crawl-pilot');
        open.onsuccess = () => { const v = open.result.version; open.result.close(); resolve(v === 7); };
        open.onerror = () => resolve(false);
    }), undefined, { timeout: 15_000 });

    expect(await fresh.store('tableData')).toEqual([]);
    const [table] = await fresh.store('tables');
    expect(table).toMatchObject({ id: 50, name: 'Laptops', jobId: 10, source: 'list', rowCount: 2, preview: false });
    expect((await fresh.store('rows')).map(r => r.data.title)).toEqual(['A', 'B']);
    const [recipe] = await fresh.store('recipes');
    expect(recipe.spec).toMatchObject({ kind: 'list', pagination: { mode: 'pagination', next: ['.s-pagination-next'] } });
    expect(recipe.spec.lists[0].items).toEqual(['div[data-component-type="s-search-result"]', '[data-index]']);
    const [job] = await fresh.store('jobs');
    expect(job).toMatchObject({ id: 10, recipeId: recipe.id, status: 'completed', tableId: 50, input: { urls: ['https://shop.test/s?k=laptop'], maxPages: 5 } });

    // The side panel shows the migrated run.
    await expect(fresh.page.locator('body')).toContainText('Laptops');
    await fresh.page.close();
});
