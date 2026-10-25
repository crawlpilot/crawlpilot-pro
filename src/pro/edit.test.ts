import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import zara from '../shared/samples/recipes/zara-product.json';
import type { ListSpec, PageSpec } from '../shared/types/database';
import { listRunInput, type RunElement } from '../shared/recipes/spec';
import { pro } from './db';
import { closeProDatabase } from './db/idb';
import { listEditInput, pageEditInput, saveListVersion, savePageVersion, setProEdit, takeProEdit } from './edit';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(async () => { await closeProDatabase(); });

const spec = zara.spec as unknown as PageSpec;
const elements = spec.elements as RunElement[];
const urls = [zara.built_on, ...zara.checked_on];

describe('sessions', () => {
    it('are taken once, by the extractor of their kind', () => {
        setProEdit({ kind: 'list' });
        expect(takeProEdit('page')).toBeNull();
        expect(takeProEdit('list')).toEqual({ kind: 'list' });
        expect(takeProEdit('list')).toBeNull();
    });
});

describe('page recipes', () => {
    it('a new recipe is version 1, named, on the first page\'s site, with its pages as samples', async () => {
        const { recipe, version } = await savePageVersion({ kind: 'page' }, { name: ' ZARA product ', elements, urls, settings: spec.settings, note: 'first' });
        expect(recipe).toMatchObject({ name: 'ZARA product', site: 'zara.com', kind: 'page', latestVersion: 1 });
        expect(version).toMatchObject({ version: 1, origin: 'built', note: 'first', pages: { kind: 'urls', urls } });
        expect((await pro.samples.list(recipe.id)).map(s => s.url)).toEqual(urls);
    });

    it('an opened version loads as it was saved; saving it untouched is refused, an edit is the next version', async () => {
        const { recipe: imported } = await pro.importRecipeFile(JSON.stringify(zara), 'tester');
        const version = (await pro.versions.get(imported.id, 1))!;
        const edit = { kind: 'page' as const, recipe: imported, version };

        const input = pageEditInput(version);
        expect(input.elements).toEqual(spec.elements);
        expect(input.urls).toEqual(urls);

        await expect(savePageVersion(edit, { name: '', elements: input.elements, urls: input.urls, settings: input.settings, note: '' }))
            .rejects.toMatchObject({ reason: 'unchanged' });

        const fewer = input.elements.filter(e => e.name !== 'origin');
        const { recipe, version: v2 } = await savePageVersion(edit, { name: '', elements: fewer, urls: input.urls, settings: input.settings, note: 'origin dropped' });
        expect(v2).toMatchObject({ version: 2, origin: 'edited', parentVersion: 1, output: version.output });
        expect(v2.outputDigest).not.toBe(version.outputDigest);
        expect(recipe.labels.latest).toBe(2);
    });
});

describe('list recipes', () => {
    const listSpec: ListSpec = {
        kind: 'list',
        lists: [{ id: 'l1', container: ['ul.results'], items: ['li.card'], mode: 'list', fields: [{ id: 'c1', name: 'title', type: 'text' }, { id: 'c2', name: 'price', type: 'price' }] }],
        pagination: { mode: 'pagination', next: ['a.next'], speed: 'slow' },
    };
    const { picks } = listRunInput(listSpec);
    const start = 'https://shop.test/search?q=jeans';

    it('a new list is version 1 from its start page; it opens again with its lists and pagination', async () => {
        const { recipe, version } = await saveListVersion({ kind: 'list' }, { name: 'Shop search', picks, mode: 'pagination', next: ['a.next'], url: start, note: '' });
        expect(recipe).toMatchObject({ site: 'shop.test', kind: 'list' });
        expect(version.pages).toEqual({ kind: 'start', url: start });
        expect(version.spec).toMatchObject({ kind: 'list', pagination: { mode: 'pagination', next: ['a.next'] } });

        const input = listEditInput(version);
        expect(input).toMatchObject({ mode: 'pagination', next: ['a.next'], url: start });
        expect(input.picks[0]).toMatchObject({ container: ['ul.results'], items: ['li.card'], patternFound: true });
        expect(input.picks[0].data.columns.map((c: any) => c.name)).toEqual(['title', 'price']);
    });

    it('an edit keeps the version\'s settings and saves the next version; untouched is refused', async () => {
        const { recipe, version } = await saveListVersion({ kind: 'list' }, { name: 'Shop search', picks, mode: 'pagination', next: ['a.next'], url: start, note: '' });
        const edit = { kind: 'list' as const, recipe, version: { ...version, settings: { ...version.settings, paginationSpeed: 'slow' } } };
        const input = listEditInput(version);

        await expect(saveListVersion({ kind: 'list', recipe, version }, { name: '', ...input, note: '' })).rejects.toMatchObject({ reason: 'unchanged' });
        const v2 = (await saveListVersion(edit, { name: '', ...input, mode: 'loadMore', next: ['button.more'], note: 'load more' })).version;
        expect(v2).toMatchObject({ version: 2, origin: 'edited', settings: { paginationSpeed: 'slow' }, spec: { pagination: { mode: 'loadMore' } } });
    });
});
