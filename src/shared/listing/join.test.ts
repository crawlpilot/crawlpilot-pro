import { describe, expect, it } from 'vitest';
import { itemUrlColumn, itemUrls, joinDetails, urlJoinKey } from './join';
import type { Column } from '../types/database';

const listColumns: Column[] = [
    { id: 'title', name: 'Title', type: 'text' },
    { id: 'url', name: 'URL', type: 'url' },
    { id: 'price', name: 'Price', type: 'text' },
];
const listRows = [
    { id: 1, data: { title: 'Desk lamp', url: 'https://www.shop.test/p/desk-lamp/', price: '$24' } },
    { id: 2, data: { title: 'Floor lamp', url: 'https://shop.test/p/floor-lamp#reviews', price: '$59' } },
    { id: 3, data: { title: 'Wall light', url: 'https://shop.test/p/wall-light', price: '$15' } },
];

describe('list + details', () => {
    it('a page address as a join key: no scheme, www, trailing slash or fragment; the query kept', () => {
        expect(urlJoinKey('https://www.Shop.test/p/a/')).toBe('shop.test/p/a');
        expect(urlJoinKey('http://shop.test/p/a#x')).toBe('shop.test/p/a');
        expect(urlJoinKey('https://shop.test/p?id=2')).toBe('shop.test/p?id=2');
        expect(urlJoinKey('mailto:a@b.test')).toBe('');
        expect(urlJoinKey(42)).toBe('');
    });

    it('the item links column, and the addresses to open, each once', () => {
        const cols: Column[] = [{ id: 'source_url', name: 'Source URL', type: 'url' }, { id: 'img', name: 'Image', type: 'image' }, ...listColumns];
        const rows = listRows.map(r => ({ ...r.data, source_url: 'https://shop.test/search', img: 'https://cdn.test/a.jpg' }));
        expect(itemUrlColumn(cols, rows)).toBe('url');
        expect(itemUrlColumn(listColumns.filter(c => c.id !== 'url'), rows)).toBeNull();
        expect(itemUrls([...rows, { url: 'https://shop.test/p/wall-light/' }], 'url')).toEqual([
            'https://www.shop.test/p/desk-lamp/', 'https://shop.test/p/floor-lamp#reviews', 'https://shop.test/p/wall-light',
        ]);
    });

    it('detail fields join onto the list rows by link; clashing names are renamed; misses are counted', () => {
        const detailColumns: Column[] = [
            { id: 'source_url', name: 'Source URL', type: 'url' },
            { id: 'price', name: 'Price', type: 'text' },
            { id: 'specs', name: 'Specs', type: 'text' },
            { id: 'recordId', name: 'Record ID', type: 'text' },
        ];
        const detailRows = [
            { data: { source_url: 'https://shop.test/p/desk-lamp', price: '$22', specs: '40 W', recordId: 'r1' } },
            { data: { source_url: 'https://shop.test/p/floor-lamp', specs: '60 W' } },
            { data: { source_url: 'https://shop.test/p/floor-lamp', specs: 'second row of the same page' } },
        ];
        const out = joinDetails(listColumns, listRows, 'url', detailColumns, detailRows);
        expect(out.columns.map(c => `${c.id}:${c.name}`)).toEqual(['title:Title', 'url:URL', 'price:Price', 'price_page:Price (page)', 'specs:Specs']);
        expect(out.updates).toEqual([
            { rowId: 1, patch: { price_page: '$22', specs: '40 W' } },
            { rowId: 2, patch: { specs: '60 W' } },
        ]);
        expect(out.matched).toBe(2);
        expect(out.unmatched).toBe(1);
    });
});
