import { describe, it, expect } from 'vitest';
import { firstPage, guessPaging, nextPage, requestParams, setParam, toRequest, unitInput, unitsFor, type ApiSpec } from './apiRecipe';
import type { NetEntry } from './types';

function entry(url: string, body?: unknown, headers: Record<string, string> = {}): NetEntry {
    return {
        seq: 1, url, method: body ? 'POST' : 'GET', status: 200, contentType: 'application/json',
        requestHeaders: { accept: 'application/json', cookie: 'sid=1', 'sec-fetch-mode': 'cors', ...headers },
        requestBody: body ? JSON.stringify(body) : undefined, responseText: '{}', size: 2, truncated: false, at: 0, via: 'fetch',
    };
}

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

function spec(e: NetEntry, json: unknown, path = ['products']): ApiSpec {
    return { kind: 'api', request: toRequest(e), page: 'https://shop.test/search', items: path, paging: guessPaging(e, json, path), maxPages: 10 };
}

describe('guessPaging', () => {
    it('a page number counts up from the recorded one', () => {
        const e = entry('https://shop.test/api/search?q=lamp&page=2');
        const s = spec(e, { products: items(20) });
        expect(s.paging).toMatchObject({ mode: 'number', param: { name: 'page' }, start: 2, step: 1 });
        const p1 = firstPage(s);
        expect(p1.request.url).toContain('page=2');
        expect(nextPage(s, p1, {}, 20)!.request.url).toContain('page=3');
    });

    it('an offset grows by the page size', () => {
        const e = entry('https://shop.test/api/search?offset=0&limit=24');
        const s = spec(e, { products: items(24) });
        expect(s.paging).toMatchObject({ mode: 'number', param: { name: 'offset' }, start: 0, step: 24 });
        const p2 = nextPage(s, firstPage(s), {}, 24)!;
        expect(nextPage(s, p2, {}, 24)!.request.url).toContain('offset=48');
    });

    it('a cursor the response hands back, sent in the JSON body', () => {
        const e = entry('https://shop.test/graphql', { variables: { first: 20, after: 'abc' } });
        const json = { data: { list: { edges: items(20), pageInfo: { hasNextPage: true, endCursor: 'def' } } } };
        const s = spec(e, json, ['data', 'list', 'edges']);
        expect(s.paging).toMatchObject({ mode: 'cursor', param: { where: 'body', path: ['variables', 'after'] }, next: ['data', 'list', 'pageInfo', 'endCursor'] });
        // The recorded cursor is where the user had scrolled to: the run starts at the beginning.
        const p1 = firstPage(s);
        expect(JSON.parse(p1.request.body!).variables).toEqual({ first: 20, after: '' });
        const p2 = nextPage(s, p1, json, 20)!;
        expect(JSON.parse(p2.request.body!).variables.after).toBe('def');
        // The same cursor again is the end.
        expect(nextPage(s, p2, json, 20)).toBeNull();
    });

    it('a link to the next page in the response', () => {
        const e = entry('https://shop.test/api/items');
        const json = { results: items(10), links: { next: '/api/items?cursor=x2' } };
        const s = spec(e, json, ['results']);
        expect(s.paging).toEqual({ mode: 'link', next: ['links', 'next'] });
        expect(nextPage(s, firstPage(s), json, 10)!.request.url).toBe('https://shop.test/api/items?cursor=x2');
        expect(nextPage(s, firstPage(s), { results: [] }, 10)).toBeNull();
    });

    it('a first page that leaves the page out, when the response counts its pages', () => {
        const e = entry('https://shop.test/api/list?q=x');
        const s = spec(e, { products: items(5), meta: { totalPages: 7 } });
        expect(s.paging).toMatchObject({ mode: 'number', param: { name: 'page' }, start: 1 });
        expect(firstPage(s).request.url).toContain('page=1');
    });

    it('nothing to page through', () => {
        expect(spec(entry('https://shop.test/api/one'), { products: items(3) }).paging).toEqual({ mode: 'none' });
    });

    it('stops on an empty page and at the page limit', () => {
        const s = { ...spec(entry('https://shop.test/api?page=1'), { products: items(2) }), maxPages: 2 };
        expect(nextPage(s, firstPage(s), {}, 0)).toBeNull();
        expect(nextPage(s, { ...firstPage(s), page: 2 }, {}, 2)).toBeNull();
    });
});

describe('templates', () => {
    it('lists query and body parameters, and drops the browser\'s own headers', () => {
        const e = entry('https://shop.test/api?q=lamp', { filters: { brand: 'acme' }, size: 20 });
        const req = toRequest(e);
        expect(req.headers).toEqual({ accept: 'application/json' });
        expect(requestParams(req).map(p => p.name)).toEqual(['q', 'brand', 'size']);
        const brand = requestParams(req)[1];
        expect(JSON.parse(setParam(req, brand, 'zeta').body!).filters.brand).toBe('zeta');
        // Numbers stay numbers.
        expect(JSON.parse(setParam(req, requestParams(req)[2], '40').body!).size).toBe(40);
    });

    it('one unit per input value, and back', () => {
        const q = spec(entry('https://shop.test/api?q=lamp&page=1'), { products: items(2) });
        q.input = { where: 'query', name: 'q', value: 'lamp' };
        const units = unitsFor(q, ['desk', 'chair', 'desk', '']);
        expect(units).toHaveLength(2);
        expect(units.map(u => unitInput(q, u))).toEqual(['desk', 'chair']);

        const b = spec(entry('https://shop.test/api', { query: 'lamp' }), { products: items(2) });
        b.input = { where: 'body', name: 'query', path: ['query'], value: 'lamp' };
        const bodyUnits = unitsFor(b, ['desk', 'chair']);
        expect(new Set(bodyUnits).size).toBe(2);
        expect(bodyUnits.map(u => unitInput(b, u))).toEqual(['desk', 'chair']);
        expect(JSON.parse(firstPage(b, 'chair').request.body!).query).toBe('chair');
        // No values: the call as recorded.
        expect(unitsFor(b)).toEqual(['https://shop.test/api']);
    });
});
