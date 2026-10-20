import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './index';
import { closeDatabase } from './idb';
import type { Job, RecipeSpec } from '../types/database';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(async () => { await closeDatabase(); });

const result = (items: Record<string, any>[], columns = [{ id: 'title', name: 'Title', type: 'text' as const }]) =>
    ({ type: 'list', source_url: 'https://shop.test/s', columns, items });

const job = (recipeId: number, tableId?: number): Job => ({
    recipeId, recipeRev: 1, status: 'completed', input: { urls: ['https://shop.test/s'] }, stats: { startTime: 1, itemsExtracted: 0 },
    ...(tableId ? { tableId } : {}), createdAt: Date.now(), updatedAt: Date.now(),
});
const metadata = (url: string): RecipeSpec => ({ kind: 'metadata', options: { url } });

describe('db', () => {
    it('stores each row once, skips duplicates and counts what was stored', async () => {
        const id = await db.tables.save(result([{ title: 'A' }, { title: 'B' }, { title: 'A' }]), { name: 'Shop' });
        expect(await db.tables.rowCount(id)).toBe(2);
        const table = await db.tables.get(id);
        expect(table?.rowCount).toBe(2);
        const rows = await db.tables.rowsPage(id, 0, 10);
        expect(rows.map(r => r.data)).toEqual([{ title: 'A' }, { title: 'B' }]);
        expect(rows[0]).not.toHaveProperty('metadata');

        expect(await db.tables.appendRows(id, [{ title: 'B' }, { title: 'C' }])).toBe(1);
        expect((await db.tables.get(id))?.rowCount).toBe(3);
        expect((await db.tables.rowsPage(id, 1, 5)).map(r => r.data.title)).toEqual(['B', 'C']);
    });

    it('replaces columns instead of merging them, and renames one', async () => {
        const id = await db.tables.save(result([{ title: 'A' }], [{ id: 'old', name: 'Old', type: 'text' }]));
        await db.tables.save(result([], [{ id: 'title', name: 'Title', type: 'text' }]), { tableId: id, preview: false });
        expect((await db.tables.get(id))?.columns.map(c => c.id)).toEqual(['title']);
        await db.tables.setColumns(id, [{ id: 'title', name: 'Title', type: 'text' }]);
        await db.tables.renameColumn(id, 'title', 'Name');
        expect((await db.tables.get(id))?.columns).toEqual([{ id: 'title', name: 'Name', type: 'text' }]);
    });

    it('keeps the user\'s renamed and removed columns when a run writes into the table again', async () => {
        const cols = [{ id: 'title', name: 'title', type: 'text' }, { id: 'price', name: 'price', type: 'text' }, { id: 'sku', name: 'sku', type: 'text' }];
        const id = await db.tables.save({ ...result([{ title: 'A', price: '1', sku: 'x' }]), columns: cols } as any, { name: 'Live', preview: true, jobId: 9 });
        await db.tables.renameColumn(id, 'title', 'Name');
        await db.tables.removeColumn(id, 'sku');
        await db.tables.save({ ...result([{ title: 'B', price: '2', sku: 'y' }]), columns: cols } as any, { name: 'Live', preview: true, jobId: 9, tableId: id });
        await db.tables.setColumns(id, cols as any);
        expect((await db.tables.get(id))?.columns).toEqual([{ id: 'title', name: 'Name', type: 'text' }, { id: 'price', name: 'price', type: 'text' }]);
        expect(await db.tables.rowCount(id)).toBe(2);
    });

    it('a cell edit changes the row and keeps the value as read; editing it back clears the mark', async () => {
        const id = await db.tables.save(result([{ title: 'Lamp' }, { title: 'Desk' }]), { name: 'Shop' });
        const [row] = await db.tables.rowsPage(id, 0, 1);
        const edited = await db.tables.updateRow(row.id!, { title: 'Desk lamp' });
        expect(edited.data.title).toBe('Desk lamp');
        expect(edited.edits).toEqual({ title: 'Lamp' });
        // A second edit keeps the first value as read.
        expect((await db.tables.updateRow(row.id!, { title: 'Table lamp' })).edits).toEqual({ title: 'Lamp' });
        const back = await db.tables.updateRow(row.id!, { title: 'Lamp' });
        expect(back.edits).toBeUndefined();
        expect((await db.tables.rowsPage(id, 0, 1))[0].data.title).toBe('Lamp');
    });

    it('only new items: rows the earlier table had are dropped, by their link when the list has one', async () => {
        const cols = [{ id: 'title', name: 'Title', type: 'text' }, { id: 'url', name: 'URL', type: 'url' }] as unknown as { id: string; name: string; type: 'text' }[];
        const before = await db.tables.save(result([{ title: 'A', url: 'https://s.test/a' }, { title: 'B', url: 'https://s.test/b' }], cols), { name: 'Run 1' });
        // B's title changed, C is new: by link, only C is new; by values, B is too.
        const items = [{ title: 'A', url: 'https://s.test/a' }, { title: 'B (sale)', url: 'https://s.test/b/' }, { title: 'C', url: 'https://s.test/c' }];
        const byLink = await db.tables.save(result(items, cols), { name: 'Run 2' });
        expect(await db.tables.keepOnlyNew(byLink, before, 'url')).toEqual({ kept: 1, removed: 2 });
        expect((await db.tables.rowsPage(byLink, 0, 10)).map(r => r.data.title)).toEqual(['C']);
        expect((await db.tables.get(byLink))?.rowCount).toBe(1);
        expect((await db.tables.get(byLink))?.view.onlyNew).toMatchObject({ against: before, removed: 2 });
        const byValues = await db.tables.save(result(items, cols), { name: 'Run 3' });
        expect(await db.tables.keepOnlyNew(byValues, before)).toEqual({ kept: 2, removed: 1 });
    });

    it('a new run of a recipe takes the column setup of its last table; another recipe\'s does not', async () => {
        const cols = [{ id: 'title', name: 'Title', type: 'text' }, { id: 'price', name: 'Price', type: 'text' }, { id: 'junk', name: 'Junk', type: 'text' }] as unknown as { id: string; name: string; type: 'text' }[];
        const recipe = await db.jobs.saveRecipe('Shop', metadata('https://shop.test/'));
        const other = await db.jobs.saveRecipe('Other', metadata('https://other.test/'));
        const firstTable = await db.tables.save(result([{ title: 'A', price: '$1', junk: 'x' }], cols), { name: 'Run 1' });
        const first = await db.jobs.create({ ...job(recipe.id, firstTable), createdAt: 1 });
        await db.tables.renameColumn(firstTable, 'price', 'Cost');
        await db.tables.removeColumn(firstTable, 'junk');
        await db.tables.update(firstTable, { view: { typed: [{ id: 'price_n', name: 'Price (number)', source: 'price', type: 'number' } as any] } });

        const secondTable = await db.tables.save(result([{ title: 'B', price: '$2', junk: 'y' }], cols), { name: 'Run 2' });
        const second = await db.jobs.create({ ...job(recipe.id, secondTable), createdAt: 2 });
        await db.jobs.carryColumnSetup(second, secondTable);
        const carried = await db.tables.get(secondTable);
        expect(carried?.columns.map(c => c.name)).toEqual(['Title', 'Cost']);
        expect(carried?.view.typed).toHaveLength(1);
        expect(first).not.toBe(second);

        const otherTable = await db.tables.save(result([{ title: 'C', price: '$3', junk: 'z' }], cols), { name: 'Other run' });
        const otherJob = await db.jobs.create({ ...job(other.id, otherTable), createdAt: 3 });
        await db.jobs.carryColumnSetup(otherJob, otherTable);
        expect((await db.tables.get(otherTable))?.columns.map(c => c.name)).toEqual(['Title', 'Price', 'Junk']);
    });

    it('overwrites a preview, never another job\'s table', async () => {
        const preview = await db.tables.save(result([{ title: 'A' }]), { name: 'Shop', preview: true });
        const final = await db.tables.save(result([{ title: 'B' }]), { name: 'Shop', jobId: 7, tableId: preview, replace: true });
        expect(final).toBe(preview);
        expect((await db.tables.get(final))?.name).toBe('Shop');
        expect((await db.tables.rowsPage(final, 0, 5)).map(r => r.data.title)).toEqual(['B']);

        const other = await db.tables.save(result([{ title: 'C' }]), { jobId: 8, tableId: final });
        expect(other).not.toBe(final);
    });

    it('keeps only the latest loose preview', async () => {
        const first = await db.tables.save(result([{ title: 'A' }]), { preview: true });
        const owned = await db.tables.save(result([{ title: 'B' }]), { preview: true, jobId: 3 });
        const second = await db.tables.save(result([{ title: 'C' }]), { preview: true });
        expect(await db.tables.get(first)).toBeNull();
        expect(await db.tables.rowCount(first)).toBe(0);
        expect(await db.tables.get(owned)).not.toBeNull();
        expect((await db.tables.list()).map(t => t.id)).toEqual([second, owned]);
    });

    it('deletes a job with its table, and its recipe only when no rerun uses it', async () => {
        const { id: recipeId } = await db.jobs.saveRecipe('r', metadata('a'));
        const tableId = await db.tables.save(result([{ title: 'A' }]));
        const first = await db.jobs.create(job(recipeId, tableId));
        const rerun = await db.jobs.create(job(recipeId));

        await db.jobs.remove({ ...job(recipeId, tableId), id: first });
        expect(await db.tables.get(tableId)).toBeNull();
        expect(await db.jobs.getRecipe(recipeId)).not.toBeNull();
        expect((await db.jobs.list()).map(j => j.id)).toEqual([rerun]);

        await db.jobs.remove({ ...job(recipeId), id: rerun });
        expect(await db.jobs.getRecipe(recipeId)).toBeNull();
    });

    it('lists jobs newest first with their recipe, and clears everything', async () => {
        const { id: recipeId } = await db.jobs.saveRecipe('r', metadata('b'));
        await db.jobs.create({ ...job(recipeId), createdAt: 1 });
        const newer = await db.jobs.create({ ...job(recipeId), createdAt: 2 });
        await db.jobs.update(newer, { status: 'failed' });
        const jobs = await db.jobs.list();
        expect(jobs.map(j => [j.id, j.status, j.recipe?.name])).toEqual([[newer, 'failed', 'r'], [1, 'completed', 'r']]);

        await db.clearAll();
        expect(await db.jobs.list()).toEqual([]);
    });
});

describe('recipes', () => {
    it('saves one recipe per spec, whatever the key order, and counts revisions', async () => {
        const a = await db.jobs.saveRecipe('Lamps', { kind: 'metadata', options: { url: 'u', includeLinks: true } });
        const b = await db.jobs.saveRecipe('Lamps again', { options: { includeLinks: true, url: 'u' }, kind: 'metadata' } as RecipeSpec);
        expect(b).toEqual(a);
        const c = await db.jobs.saveRecipe('Other', metadata('v'));
        expect(c.id).not.toBe(a.id);
        expect(await db.jobs.reviseRecipe(a.id, metadata('w'))).toBe(2);
        expect((await db.jobs.getRecipe(a.id))?.rev).toBe(2);
    });
});

describe('migration v5 → v6', () => {
    const fullSelector = (container: string) => ({
        id: 'sel-1', containerSelector: 'div > div:nth-of-type(2)', containerXPath: '//*[@id="x"]/div[1]/div[2]/div[3]',
        containerSelectors: [{ selector: container, strategy: 'Minimal' }, { selector: '.css-1x2y3z', strategy: 'CSS Gen' }],
        itemSelector: '[data-index]', itemSelectors: [{ selector: 'div[data-component-type="s-search-result"]', strategy: 'Deductive CSS' }],
        patternFound: true, count: 16, selectionMode: 'list', sourceTabId: 7,
        data: { columns: [{ id: 'title', name: 'Title', type: 'text' }] },
    });
    const listConfig = (container: string, maxPages: number) => ({
        type: 'list-extraction', selectors: [container],
        options: { pagination: { mode: 'pagination', nextButtonSelector: '.s-pagination-next', maxPages }, fullSelectors: [fullSelector(container)] },
    });
    const bulkConfig = {
        type: 'bulk-extraction', urls: ['https://a.test/1', 'https://a.test/2'],
        options: { actions: [{ type: 'EXTRACT_PAGES', config: { actionSpeed: 500 }, elements: [
            { id: 'e1', name: 'Title', action: 'extract', type: 'text', value: 'Lamp', selectors: [{ type: 'css', value: '#productTitle' }, { type: 'xpath', value: '//span[@id="productTitle"]' }] },
        ] }] },
    };

    async function seedV5() {
        const v5: IDBDatabase = await new Promise((resolve, reject) => {
            const open = indexedDB.open('crawl-pilot', 5);
            open.onupgradeneeded = () => {
                const d = open.result;
                const t = d.createObjectStore('tableData', { keyPath: 'id', autoIncrement: true });
                t.createIndex('name', 'name'); t.createIndex('createdAt', 'createdAt'); t.createIndex('automationId', 'automationId');
                const r = d.createObjectStore('tableRows', { keyPath: 'id', autoIncrement: true });
                r.createIndex('tableDataId', 'tableDataId'); r.createIndex('createdAt', 'createdAt'); r.createIndex('tableData_dataHash', ['tableDataId', 'dataHash'], { unique: true });
                const rc = d.createObjectStore('recipes', { keyPath: 'id', autoIncrement: true });
                rc.createIndex('type', 'type'); rc.createIndex('createdAt', 'createdAt');
                const j = d.createObjectStore('jobs', { keyPath: 'id', autoIncrement: true });
                j.createIndex('recipeId', 'recipeId'); j.createIndex('status', 'status'); j.createIndex('sourceUrl', 'sourceUrl'); j.createIndex('createdAt', 'createdAt');
            };
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
        });
        const tx = v5.transaction(['recipes', 'jobs', 'tableData'], 'readwrite');
        const recipes = tx.objectStore('recipes');
        const jobs = tx.objectStore('jobs');
        recipes.put({ id: 1, name: 'Laptops', type: 'list-extraction', version: 1, config: listConfig('.s-main-slot', 5), createdAt: 1, updatedAt: 1 });
        recipes.put({ id: 2, name: 'Laptops (copy)', type: 'list-extraction', version: 1, config: listConfig('.s-main-slot', 9), createdAt: 2, updatedAt: 2 });
        recipes.put({ id: 3, name: 'Products', type: 'bulk-extraction', version: 1, config: bulkConfig, createdAt: 3, updatedAt: 3 });
        recipes.put({ id: 4, name: 'Meta', type: 'metadata-extraction', version: 1, config: { type: 'metadata-extraction', urls: ['https://m.test'], options: { includeLinks: true } }, createdAt: 4, updatedAt: 4 });
        // Job 10 ran recipe 1, but its snapshot had a different container (the recipe was saved filtered).
        jobs.put({ id: 10, recipeId: 1, status: 'completed', sourceUrl: 'https://shop.test/s?k=laptop', configSnapshot: listConfig('#search .s-main-slot', 5), stats: { startTime: 1, itemsExtracted: 16 }, result: { tableDataId: 50 }, logs: [], createdAt: 10, updatedAt: 10 });
        jobs.put({ id: 11, recipeId: 2, status: 'paused', sourceUrl: 'https://shop.test/s?k=laptop', stats: { startTime: 2, itemsExtracted: 3, stoppedByUser: true }, createdAt: 11, updatedAt: 11 });
        jobs.put({ id: 12, recipeId: 3, status: 'completed', configSnapshot: bulkConfig, stats: { startTime: 3, itemsExtracted: 2 }, createdAt: 12, updatedAt: 12 });
        jobs.put({ id: 13, recipeId: 99, status: 'pending', sourceUrl: 'https://gone.test', configSnapshot: { type: 'email-extraction' }, stats: { startTime: 4, itemsExtracted: 0 }, createdAt: 13, updatedAt: 13 });
        tx.objectStore('tableData').put({
            id: 50, name: 'Laptops', columns: [{ id: 'title', name: 'Title', type: 'text' }], sourceUrl: 'u', createdAt: 1, updatedAt: 1, jobId: 10,
            metadata: { extractionType: 'list', totalRows: 99, isPreview: false, columnMerges: [{ id: 'm', name: 'M', sources: ['title'], separator: ' ' }] },
        });
        tx.objectStore('tableData').put({ id: 51, name: 'Preview: Lamps', columns: [], sourceUrl: 'v', createdAt: 2, updatedAt: 2, metadata: { isPreview: true } });
        // The same item read on two pages (only source_url differs): one row from v7 on.
        const rows = [
            { tableDataId: 50, data: { title: 'A', source_url: 'p1' }, dataHash: 'h1', createdAt: 1, metadata: { originalData: {} } },
            { tableDataId: 50, data: { title: 'A', source_url: 'p2' }, dataHash: 'h2', createdAt: 2 },
            { tableDataId: 50, data: { title: 'B', source_url: 'p2' }, dataHash: 'h3', createdAt: 3 },
            { tableDataId: 51, data: { title: 'Lamp' }, dataHash: 'h4', createdAt: 4 },
        ];
        await new Promise(r => { tx.oncomplete = r; });
        const rowTx = v5.transaction('tableRows', 'readwrite');
        rows.forEach(r => rowTx.objectStore('tableRows').add(r));
        await new Promise(r => { rowTx.oncomplete = r; });
        v5.close();
    }

    it('types every recipe, merges identical ones, and points each job at the config it ran', async () => {
        await seedV5();
        const jobs = await db.jobs.list();
        const byId = new Map(jobs.map(j => [j.id, j]));

        // Recipes 1 and 2 differ only in maxPages (now a run input): one recipe, id 1.
        const laptops = byId.get(11)!;
        expect(laptops.recipeId).toBe(1);
        expect(laptops.status).toBe('stopped');
        expect(laptops.input).toEqual({ urls: ['https://shop.test/s?k=laptop'], maxPages: 9 });
        const spec = laptops.recipe!.spec;
        expect(spec.kind).toBe('list');
        if (spec.kind === 'list') {
            // Positions, hash classes and the positional XPath are dropped; the named entries are kept.
            expect(spec.lists[0].container).toEqual(['.s-main-slot']);
            expect(spec.lists[0].items).toEqual(['div[data-component-type="s-search-result"]', '[data-index]']);
            expect(spec.lists[0].fields).toEqual([{ id: 'title', name: 'Title', type: 'text' }]);
            expect(spec.pagination).toEqual({ mode: 'pagination', next: ['.s-pagination-next'] });
        }

        // Job 10's snapshot differs from its recipe: it gets the recipe of what it ran.
        const ran = byId.get(10)!;
        expect(ran.recipeId).not.toBe(1);
        expect(ran.recipe?.spec.kind === 'list' && ran.recipe.spec.lists[0].container).toEqual(['#search .s-main-slot']);
        expect(ran.tableId).toBe(50);
        expect(ran).not.toHaveProperty('configSnapshot');
        expect(ran).not.toHaveProperty('result');

        const bulk = byId.get(12)!;
        expect(bulk.recipeId).toBe(3);
        expect(bulk.input.urls).toEqual(['https://a.test/1', 'https://a.test/2']);
        expect(bulk.recipe?.spec).toEqual({
            kind: 'page', settings: { actionSpeed: 500 },
            elements: [{ id: 'e1', name: 'Title', action: 'extract', type: 'text', selectors: ['#productTitle', '//span[@id="productTitle"]'], shape: 'text' }],
        });

        // Unreadable config: the job stays, without a recipe.
        expect(byId.get(13)).toMatchObject({ status: 'stopped', recipeRev: 0, recipe: undefined });
        expect((await db.jobs.getRecipe(4))?.spec).toEqual({ kind: 'metadata', options: { includeLinks: true } });

        // Saving the same pick again finds the migrated recipe.
        expect((await db.jobs.saveRecipe('again', spec)).id).toBe(1);
    });

    it('moves tables and rows to the v7 stores: same ids, view settings apart, one row per item', async () => {
        await seedV5();
        const table = await db.tables.get(50);
        expect(table).toMatchObject({
            id: 50, name: 'Laptops', jobId: 10, source: 'list', sourceUrl: 'u', rowCount: 2, preview: false,
            view: { merges: [{ id: 'm', name: 'M', sources: ['title'], separator: ' ' }] },
        });
        expect(table).not.toHaveProperty('metadata');
        expect((await db.tables.rowsPage(50, 0, 10)).map(r => r.data)).toEqual([{ title: 'A', source_url: 'p1' }, { title: 'B', source_url: 'p2' }]);
        expect((await db.tables.rowsPage(50, 0, 10))[0]).not.toHaveProperty('metadata');
        expect(await db.tables.get(51)).toMatchObject({ preview: true, rowCount: 1, view: {} });
        // A job's table id still points at its table.
        expect((await db.jobs.get(10))?.tableId).toBe(50);
    });
});
