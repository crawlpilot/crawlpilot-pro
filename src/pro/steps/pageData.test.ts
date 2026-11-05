import { beforeEach, describe, expect, it } from 'vitest';
import { newFieldOf } from '../pages/PageDataSource';
import { listPageData } from './pageData';

beforeEach(() => {
    document.head.innerHTML = `
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Lamp","sku":"LX-1","offers":{"price":"24.99","priceCurrency":"USD"}}</script>
        <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"product":{"usItemId":"123","priceInfo":{"currentPrice":{"price":194}},"tags":["grill","outdoor"],"variants":[{"id":"a","color":"Red"},{"id":"b","color":"Blue"}],"specifications":[{"name":"Fuel type","value":"Propane"},{"name":"Burners","value":"4"}],"shortDescription":"A four-burner propane grill with side shelves, wheels and a stainless steel lid, for everyday cookouts."}}}}</script>`;
    document.body.innerHTML = '<h1>Lamp</h1>';
});

describe('the page\'s data for the editor', () => {
    it('lists values with where they are, plain lists whole, list positions last', () => {
        const all = listPageData();
        const where = all.map(e => e.where);
        expect(where).toContain('__NEXT_DATA__ · props.pageProps.product.usItemId');
        expect(all.find(e => e.where.endsWith('product.tags'))).toMatchObject({ value: 'grill, outdoor', binding: { kind: 'json', label: '__NEXT_DATA__', as: 'list', path: ['props', 'pageProps', 'product', 'tags'] } });
        expect(where.indexOf('__NEXT_DATA__ · props.pageProps.product.variants.0.id')).toBeGreaterThan(where.indexOf('__NEXT_DATA__ · props.pageProps.product.usItemId'));
        expect(all.some(e => e.binding.kind === 'ld' && e.value === '24.99')).toBe(true);
    });

    it('finds by key or by value', () => {
        expect(listPageData('currentprice').map(e => e.value)).toEqual(['194']);
        expect(listPageData('LX-1').map(e => e.where)).toEqual([expect.stringMatching(/ · sku$/)]);
    });

    it('a value chosen makes a field: named from its key, typed from its value', () => {
        const [price] = listPageData('currentprice');
        expect(newFieldOf(price, ['price'], 'f1')).toMatchObject({ id: 'f1', name: 'price_2', type: 'number', read: 'text', ways: [{ kind: 'data', binding: price.binding }] });
        const [tags] = listPageData('tags');
        expect(newFieldOf(tags, [], 'f2')).toMatchObject({ name: 'tags', type: 'list', read: 'text_array' });
        const [id] = listPageData('usItemId');
        expect(newFieldOf(id, [], 'f3').name).toBe('us_item_id');
    });
});

describe('lists of objects', () => {
    it('are offered whole as rows, and name / value lists as one object, ahead of the values inside them', () => {
        const variants = listPageData('variants');
        expect(variants[0]).toMatchObject({ value: '2 rows: id, color', binding: { as: 'rows', keys: ['id', 'color'], names: ['id', 'color'] } });
        const specs = listPageData('Fuel type');
        expect(specs[0]).toMatchObject({ value: 'Fuel type: Propane; Burners: 4', binding: { as: 'object', keys: ['name', 'value'], path: ['props', 'pageProps', 'product', 'specifications'] } });
        expect(newFieldOf(specs[0], [], 'f')).toMatchObject({ name: 'specifications', type: 'object', read: 'text' });
        expect(newFieldOf(variants[0], [], 'g')).toMatchObject({ name: 'variants', type: 'table', read: 'table' });
    });
});

describe('Walmart\'s specifications, held in its page data', () => {
    it('are found, become a field of name → value, are read, and go through a transform', async () => {
        const { readFileSync } = await import('node:fs');
        const { gunzipSync } = await import('node:zlib');
        const { extractPage } = await import('../../content/services/page/extractPage');
        const { pageRequest, readPageResult } = await import('../runner/readPage');
        Element.prototype.scrollIntoView = () => undefined;
        const html = gunzipSync(readFileSync('src/test/fixtures/corpus/pdp-walmart.html.gz')).toString('utf8');
        document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>[\s\S]*$/i, '');
        const entry = listPageData('specifications').find(e => e.binding.as === 'object')!;
        expect(entry.where).toBe('__NEXT_DATA__ · props.pageProps.initialData.data.idml.specifications');
        const field = newFieldOf(entry, [], 'specs');
        const spec = { kind: 'page' as const, steps: [{ kind: 'field' as const, field }],
            transform: { jolt: [{ operation: 'shift' as const, spec: { specifications: { 'Fuel type': 'fuel', 'Number of burners': 'burners' } } }] } };
        const req = pageRequest(spec, {});
        const out = await extractPage(req.elements as never, { ...req.config, waitMs: 0 } as never) as { item?: Record<string, unknown> };
        const page = readPageResult(spec, 'u', out.item ?? {});
        expect(page.fields[0]).toMatchObject({ ok: true, value: expect.objectContaining({ 'Fuel type': 'Propane', Brand: 'Expert Grill', 'Number of burners': '4' }) });
        expect(page.record).toEqual({ fuel: 'Propane', burners: '4' });
    }, 60_000);
});

describe('a new field\'s type', () => {
    it('is a number only for counts and prices: ids and codes stay text, leading zeros kept', async () => {
        const { looksLikeNumber } = await import('../pages/PageDataSource');
        expect(['194', '4.2', '6968', '-3', '0.5'].map(looksLikeNumber)).toEqual([true, true, true, true, true]);
        expect(['17070020028', '044376300333', '00123', '12345678'].map(looksLikeNumber)).toEqual([false, false, false, false]);
    });
});
