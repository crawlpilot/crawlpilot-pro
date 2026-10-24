import { describe, expect, it } from 'vitest';
import nextSearch from '../../test/fixtures/page-json/next-search.json';
import ldProduct from '../../test/fixtures/page-json/ld-product.json';
import { bindingsFor, entityByType, scanPageJson, type JsonSource } from './scan';
import { attributeName, attributesOf } from './attributes';
import { follow, readKey } from './path';
import { isNoiseKey } from './noise';

const next: JsonSource = { kind: 'json', label: '__NEXT_DATA__', nth: 0, data: nextSearch };
const ld = (data: unknown, nth = 0): JsonSource => ({ kind: 'ld', label: 'JSON-LD', nth, data });

describe('scanPageJson', () => {
    it('ranks the search results first among lists and never offers the sponsored ones', () => {
        const lists = scanPageJson([next]).filter(c => c.kind === 'list');
        expect(lists[0]).toMatchObject({ title: 'products', count: 3, path: ['props', 'pageProps', 'search', 'products'] });
        expect(lists.some(c => c.title === 'sponsoredProducts')).toBe(false);
    });

    it('offers each JSON-LD entity as an item addressed by its @type', () => {
        const items = scanPageJson([ld(ldProduct)]).filter(c => c.kind === 'item');
        const product = items.find(c => c.type === 'Product')!;
        expect(product).toMatchObject({ title: 'Product', path: [], source: { kind: 'ld' } });
        expect(items[0].type).toBe('Product'); // more values than the breadcrumb
    });

    it('offers an app-state object with many values as an item', () => {
        const items = scanPageJson([next]).filter(c => c.kind === 'item');
        expect(items.map(c => c.title)).toContain('pageInfo');
    });
});

describe('attributesOf', () => {
    const products = (nextSearch as any).props.pageProps.search.products;

    it('lists leaf values, lists of values and name → value entries, with fill, type and samples', () => {
        const attrs = attributesOf(products);
        const by = (k: string) => attrs.find(a => a.key === k)!;
        expect(by('name')).toMatchObject({ name: 'name', fill: 1, suggested: true, sample: 'Trail Runner 2' });
        expect(by('brand.name')).toMatchObject({ name: 'brand name', suggested: true });
        expect(by('price.current')).toMatchObject({ type: 'number' });
        expect(by('images[*].url')).toMatchObject({ many: true, type: 'url' });
        expect(by('specs[name=Weight].value')).toMatchObject({ name: 'weight', sample: '280 g', suggested: false });
        expect(attrs.some(a => a.key.includes('typename'))).toBe(false);
    });

    it('names attributes the way people say them', () => {
        expect(attributeName('offers.price')).toBe('price');
        expect(attributeName('aggregateRating.ratingValue')).toBe('rating value');
        expect(attributeName('additionalProperty[name=Color].value')).toBe('color');
        expect(attributeName('images[*].url')).toBe('images url');
    });
});

describe('readKey', () => {
    const item = (ldProduct as any)[1];
    it('reads keys, every item of a list, and the item with a label', () => {
        expect(readKey(item, 'offers.price')).toBe('89.00');
        expect(readKey(item, 'image')).toEqual(['https://img.example.com/tr2-a.jpg', 'https://img.example.com/tr2-b.jpg']);
        expect(readKey(item, 'additionalProperty[name=Weight].value')).toBe('280 g');
        expect(readKey({ images: [{ url: 'a' }, { url: 'b' }] }, 'images[*].url')).toEqual(['a', 'b']);
        expect(readKey(item, 'missing.key')).toBeUndefined();
    });

    it('finds a labelled item wherever it moved', () => {
        const moved = { ...item, additionalProperty: [...item.additionalProperty].reverse() };
        expect(readKey(moved, 'additionalProperty[name=Weight].value')).toBe('280 g');
    });
});

describe('bindings', () => {
    it('reads a JSON-LD entity by @type even when another block comes before it', () => {
        const before = [ld({ '@type': 'Organization', name: 'Shop' }, 0), ld(ldProduct, 1)];
        expect(entityByType(before, 'Product')?.name).toBe('Trail Runner 2');
    });

    it('turns a list and its picks into one list element bound to the data', () => {
        const list = scanPageJson([next]).find(c => c.kind === 'list')!;
        const [el] = bindingsFor(list, [{ key: 'name', name: 'title' }, { key: 'price.current', name: 'price' }], 1);
        expect(el).toMatchObject({ type: 'list', selectors: [], data: { kind: 'json', label: '__NEXT_DATA__', as: 'rows', keys: ['name', 'price.current'], names: ['title', 'price'] } });
        const rows = (follow(nextSearch, el.data.path) as unknown[]).map(o => el.data.keys!.map(k => readKey(o, k)));
        expect(rows[1]).toEqual(['Road Glide', 120.5]);
    });

    it('turns an item and its picks into one element per attribute', () => {
        const product = scanPageJson([ld(ldProduct)]).find(c => c.type === 'Product')!;
        const els = bindingsFor(product, [{ key: 'offers.price', name: 'price' }, { key: 'image', name: 'images', many: true }], 1);
        expect(els.map(e => [e.type, e.data.as, e.data.key, e.data.type])).toEqual([['text', 'text', 'offers.price', 'Product'], ['text_array', 'list', 'image', 'Product']]);
    });
});

describe('isNoiseKey', () => {
    it('skips advertising and telemetry but keeps words that only contain "ad"', () => {
        expect(['sponsoredProducts', 'adSlot', 'tracking', '__typename', 'impressions'].every(isNoiseKey)).toBe(true);
        expect(['shadeName', 'gradeLabel', 'address', 'download'].some(isNoiseKey)).toBe(false);
    });
});
