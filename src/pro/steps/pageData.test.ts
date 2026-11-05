import { beforeEach, describe, expect, it } from 'vitest';
import { newFieldOf } from '../pages/PageDataSource';
import { listPageData } from './pageData';

beforeEach(() => {
    document.head.innerHTML = `
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Lamp","sku":"LX-1","offers":{"price":"24.99","priceCurrency":"USD"}}</script>
        <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"product":{"usItemId":"123","priceInfo":{"currentPrice":{"price":194}},"tags":["grill","outdoor"],"variants":[{"id":"a"},{"id":"b"}],"shortDescription":"A four-burner propane grill with side shelves, wheels and a stainless steel lid, for everyday cookouts."}}}}</script>`;
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
