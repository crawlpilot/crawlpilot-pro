import { describe, expect, it } from 'vitest';
import type { CrawlStatus } from '../backend/types';
import type { PageResult } from '../runner/testPage';
import { baselineOf, crawlHealth } from './health';

const page = (filled: Record<string, boolean>, error?: string): PageResult => ({
    url: 'u', clicks: [], ...(error ? { error } : {}),
    fields: Object.entries(filled).map(([name, f]) => ({ fieldId: name, name, status: 'ok', raw: null, value: null, cleaned: null, filled: f, ok: true })),
});
const crawl = (fill: Record<string, number>, status: CrawlStatus['status'] = 'done', failing: Record<string, string[]> = {}): CrawlStatus => ({
    id: 'c', status, pagesDone: 10, pagesFailed: 0, samples: [],
    fields: Object.entries(fill).map(([name, f]) => ({ name, fill: f, ...(failing[name] ? { failingPages: failing[name] } : {}) })),
});

describe('health', () => {
    it('takes the baseline from the pages that were read', () => {
        expect(baselineOf([page({ title: true, price: true }), page({ title: true, price: false }), page({}, 'Timed out')]))
            .toEqual({ title: 1, price: 0.5 });
    });

    it('a field that fills much less needs a repair, a little less is worth watching', () => {
        const h = crawlHealth({ title: 1, price: 0.98, brand: 1 }, crawl({ title: 0.95, price: 0.1, brand: 0.85 }, 'done', { price: ['https://s.test/p/9'] }))!;
        expect(h.state).toBe('repair');
        expect(h.fields).toEqual([
            { name: 'price', baseline: 0.98, now: 0.1, state: 'repair', failingPages: ['https://s.test/p/9'] },
            { name: 'brand', baseline: 1, now: 0.85, state: 'watch', failingPages: [] },
        ]);
        expect(crawlHealth({ title: 1 }, crawl({ title: 0.97 }))).toEqual({ state: 'healthy', fields: [] });
    });

    it('says nothing until the crawl is done and there is a baseline', () => {
        expect(crawlHealth({ title: 1 }, crawl({ title: 0 }, 'running'))).toBeNull();
        expect(crawlHealth(undefined, crawl({ title: 0 }))).toBeNull();
    });
});
