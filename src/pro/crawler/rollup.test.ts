import { describe, expect, it } from 'vitest';
import { dailyUsage, rollupDay, yesterday } from './rollup';

const way = (key: string, field: string, docs: number, tried: number, matched: number, won: number) =>
    ({ key, doc_count: docs, field: { buckets: [{ key: field }] }, tried: { doc_count: tried }, matched: { doc_count: matched }, won: { doc_count: won } });
const bucket = (recipeId: string, ways: object[]) => ({ key: { recipeId, competitor: 'acme', pageType: 'product' }, ways: { way: { buckets: ways } } });

describe('daily selector usage', () => {
    it('reads one day of loaded pages, page by page, from that month\'s index', async () => {
        const calls: { url: string; body: any }[] = [];
        const pages = [
            { aggregations: { recipes: { buckets: Array.from({ length: 500 }, (_, i) => bucket(`r${i}`, [])), after_key: { recipeId: 'r499' } } } },
            { aggregations: { recipes: { buckets: [bucket('rec-1', [way('w-h1', 'title', 120, 120, 118, 118), way('w-old', 'title', 120, 120, 0, 0)])] } } },
        ];
        pages[0].aggregations.recipes.buckets[0] = bucket('r0', [way('w-a', 'price', 5, 5, 5, 5)]);
        const fetch = (async (url: string, init: RequestInit) => {
            calls.push({ url, body: JSON.parse(String(init.body)) });
            return new Response(JSON.stringify(pages.shift()), { status: 200 });
        }) as unknown as typeof globalThis.fetch;
        const days = await dailyUsage({ url: 'https://es.test', indexPrefix: 'p-' }, '2026-10-27', fetch);
        expect(calls[0].url).toBe('https://es.test/p-selector-usage-2026.10/_search');
        expect(calls[0].body.query.bool.filter).toEqual([
            { range: { crawledAt: { gte: '2026-10-27T00:00:00Z', lt: '2026-10-28T00:00:00Z' } } }, { term: { pageStatus: 'ok' } },
        ]);
        expect(calls[1].body.aggs.recipes.composite.after).toEqual({ recipeId: 'r499' });
        expect(days).toEqual([
            { date: '2026-10-27', recipeId: 'r0', competitor: 'acme', pageType: 'product', field: 'price', wayId: 'w-a', pages: 5, tried: 5, matched: 5, won: 5 },
            { date: '2026-10-27', recipeId: 'rec-1', competitor: 'acme', pageType: 'product', field: 'title', wayId: 'w-h1', pages: 120, tried: 120, matched: 118, won: 118 },
            { date: '2026-10-27', recipeId: 'rec-1', competitor: 'acme', pageType: 'product', field: 'title', wayId: 'w-old', pages: 120, tried: 120, matched: 0, won: 0 },
        ]);
    });

    it('writes each way-day under a fixed id, so a rerun replaces it; a month with no crawls writes nothing', async () => {
        const bulks: string[] = [];
        const fetch = (async (url: string, init: RequestInit) => {
            if (url.endsWith('/_bulk')) { bulks.push(String(init.body)); return new Response('{"errors":false,"items":[]}', { status: 200 }); }
            return new Response(JSON.stringify({ aggregations: { recipes: { buckets: [bucket('rec-1', [way('w-h1', 'title', 3, 3, 3, 3)])] } } }), { status: 200 });
        }) as unknown as typeof globalThis.fetch;
        expect(await rollupDay({ url: 'https://es.test' }, '2026-10-27', fetch)).toBe(1);
        expect(bulks[0].split('\n')[0]).toBe(JSON.stringify({ index: { _index: 'selector-usage-daily-2026', _id: 'rec-1:w-h1:2026-10-27' } }));

        const none = (async () => new Response('{}', { status: 404 })) as unknown as typeof globalThis.fetch;
        expect(await dailyUsage({ url: 'https://es.test' }, '2026-01-01', none)).toEqual([]);
        await expect(dailyUsage({ url: 'https://es.test' }, '27/10/2026', none)).rejects.toThrow('Not a date');
        expect(yesterday(Date.parse('2026-10-28T00:30:00Z'))).toBe('2026-10-27');
    });
});
