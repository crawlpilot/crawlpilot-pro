import { describe, it, expect } from 'vitest';
import { findValuePaths, formatPath, generalisePath, resolvePath, arrayPathOf, parseNumberish } from './jsonSearch';
import { tableFromArray } from './arrayTable';
import { toRequestSnippet, detectPagingParams, exportableHeaders } from './requestSnippets';
import type { NetEntry } from './types';

const API = {
    data: {
        search: {
            total: 120,
            products: [
                { id: 'a1', title: 'Desk Lamp', price: { value: 24.99, currency: 'USD' }, tags: ['home', 'light'] },
                { id: 'b2', title: 'Office Chair', price: { value: 149, currency: 'USD' }, tags: [] },
                { id: 'c3', title: 'Monitor Arm', priceCents: 5950, tags: ['desk'] },
            ],
        },
    },
};

describe('parseNumberish', () => {
    it.each([
        ['$24.99', 24.99], ['1,299.00', 1299], ['1.299,00 €', 1299], ['149', 149], ['4,5', 4.5], ['no number', undefined], ['1 of 2', undefined],
    ] as const)('%s → %s', (s, n) => expect(parseNumberish(s)).toBe(n));
});

describe('findValuePaths', () => {
    it('finds text, prices and cents', () => {
        expect(formatPath(findValuePaths(API, 'Office Chair')[0].path)).toBe('data.search.products[1].title');
        expect(formatPath(findValuePaths(API, '$24.99')[0].path)).toBe('data.search.products[0].price.value');
        expect(formatPath(findValuePaths(API, '$59.50')[0].path)).toBe('data.search.products[2].priceCents');
    });
    it('matches case-insensitively and by containment for longer text', () => {
        expect(findValuePaths(API, 'desk lamp')[0].match).toBe('exact');
        expect(findValuePaths(API, 'Monitor Arm — black').some(h => h.match === 'contains')).toBe(true);
    });
});

describe('paths', () => {
    it('generalises and resolves over the list', () => {
        const hit = findValuePaths(API, 'Office Chair')[0];
        const gen = generalisePath(hit.path)!;
        expect(formatPath(gen)).toBe('data.search.products[*].title');
        expect(resolvePath(API, gen)).toEqual(['Desk Lamp', 'Office Chair', 'Monitor Arm']);
        expect(formatPath(arrayPathOf(gen)!)).toBe('data.search.products');
    });
    it('quotes odd keys', () => {
        expect(formatPath(['data', 'my-key', 0])).toBe('data["my-key"][0]');
    });
});

describe('tableFromArray', () => {
    it('flattens nested objects and joins scalar arrays', () => {
        const t = tableFromArray(API.data.search.products);
        expect(t.columns).toEqual(['id', 'title', 'price.value', 'price.currency', 'tags', 'priceCents']);
        expect(t.rows[0]['tags']).toBe('home, light');
        expect(t.rows[2]['price.value']).toBeUndefined();
    });
});

const ENTRY: NetEntry = {
    seq: 1, url: 'https://api.ex.com/v2/search?q=lamp&page=2&per_page=24', method: 'POST', status: 200,
    contentType: 'application/json',
    requestHeaders: { 'content-type': 'application/json', authorization: 'Bearer abc', 'x-client': 'web', cookie: 'a=b', 'sec-fetch-mode': 'cors' },
    requestBody: '{"filters":{"brand":"x"},"cursor":"eyJ"}', responseText: '{}', size: 2, truncated: false, at: 0, via: 'fetch',
};

describe('request export', () => {
    it('drops browser-only headers and auth unless asked', () => {
        expect(exportableHeaders(ENTRY, false)).toEqual({ 'content-type': 'application/json', 'x-client': 'web' });
        expect(exportableHeaders(ENTRY, true)).toHaveProperty('authorization');
    });
    it('writes curl and python', () => {
        const curl = toRequestSnippet('curl', ENTRY);
        expect(curl).toContain("curl 'https://api.ex.com/v2/search?q=lamp&page=2&per_page=24'");
        expect(curl).toContain('-X POST');
        expect(curl).toContain(`--data-raw '{"filters":{"brand":"x"},"cursor":"eyJ"}'`);
        expect(curl).not.toContain('Bearer');
        const py = toRequestSnippet('python', ENTRY);
        expect(py).toContain('requests.post(');
        expect(py).toContain('json=payload');
    });
    it('finds paging parameters in the query and the JSON body', () => {
        const p = detectPagingParams(ENTRY);
        expect(p).toEqual(expect.arrayContaining([
            { name: 'page', value: '2', role: 'page', where: 'query' },
            { name: 'per_page', value: '24', role: 'size', where: 'query' },
            { name: 'cursor', value: 'eyJ', role: 'page', where: 'body' },
        ]));
    });
});
