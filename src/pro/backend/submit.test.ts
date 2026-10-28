import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pro } from '../db';
import { closeProDatabase } from '../db/idb';
import type { PageResult } from '../runner/testPage';
import type { Targeting, VersionDraft } from '../recipe/types';
import { createClient } from './client';
import { createMockBackend, mockFetch } from './mock';
import { refreshCrawls, submitVersion } from './submit';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(async () => { await closeProDatabase(); });

const BASE = 'https://crawler.test';
const draft: VersionDraft = {
    spec: { kind: 'page', steps: [{ kind: 'field', field: { id: 't', name: 'title', type: 'text', read: 'text', ways: [{ kind: 'selector', selector: 'h1' }], ops: [] } }] },
    settings: {}, pages: { kind: 'urls', urls: ['https://s.test/1', 'https://s.test/2', 'https://s.test/3'] }, output: {},
};
const result = (url: string): PageResult => ({ url, clicks: [], fields: [{ fieldId: 't', name: 'title', status: 'ok', raw: 'A', value: 'A', cleaned: 'A', filled: true, ok: true }] });

async function setup(targeting: Targeting = { competitor: 'shop', pageType: 'product' }) {
    const backend = createMockBackend();
    const api = createClient({ baseUrl: BASE, token: 'dev-token', fetch: mockFetch(backend, BASE), sleep: async () => {} });
    const recipe = await pro.recipes.create({ name: 'Shop', site: 's.test', kind: 'page', ...targeting });
    const version = await pro.versions.save(recipe.id, 0, draft, { note: 'v1', origin: 'built', author: 'me' });
    return { backend, api, recipe, version };
}

const approve = (recipeId: string, version = 1) => pro.reviews.review(recipeId, version, { state: 'approved', by: 'reviewer', note: 'checked' });

async function approved(targeting?: Targeting) {
    const s = await setup(targeting);
    await approve(s.recipe.id);
    return s;
}

const testPages = (recipeId: string, digest: string, n = 3) =>
    pro.tests.save({ recipeId, digest, kind: 'pages', results: draft.pages.kind === 'urls' ? draft.pages.urls.slice(0, n).map(result) : [], passed: true, at: Date.now() });

describe('submit', () => {
    it('refuses a version that is not ready, and sends nothing', async () => {
        const { api, backend, recipe, version } = await setup();
        await expect(submitVersion(api, recipe, version, 'once', 'me')).rejects.toMatchObject({ kind: 'invalid', message: expect.stringMatching(/^Not ready to submit\. Not tested on sample pages yet\. Not reviewed/) });
        await testPages(recipe.id, version.digest, 2);
        await expect(submitVersion(api, recipe, version, 'once', 'me')).rejects.toMatchObject({ message: expect.stringContaining('it needs 3') });
        expect(backend.log).toEqual([]);
    });

    it('refuses a version nobody else approved, or one rejected since', async () => {
        const { api, backend, recipe, version } = await setup();
        await testPages(recipe.id, version.digest);
        await expect(submitVersion(api, recipe, version, 'once', 'me')).rejects.toMatchObject({ message: 'Not ready to submit. Not reviewed: someone other than its author approves it first.' });
        await approve(recipe.id);
        await pro.reviews.review(recipe.id, 1, { state: 'rejected', by: 'lead', note: 'wrong price' });
        await expect(submitVersion(api, recipe, version, 'once', 'me')).rejects.toMatchObject({ message: 'Not ready to submit. Rejected by lead: wrong price' });
        expect(backend.log).toEqual([]);
    });

    it('refuses a recipe the workers could not find: no competitor or page type, or rules that leave out a sample', async () => {
        const { api, backend, recipe, version } = await approved({});
        await testPages(recipe.id, version.digest);
        await expect(submitVersion(api, recipe, version, 'once', 'me')).rejects.toMatchObject({ message: 'Not ready to submit. Set the competitor. Set the page type.' });

        await pro.samples.add(recipe.id, ['https://s.test/p/1', 'https://s.test/sale/2']);
        const ruled = await pro.recipes.setTargeting(recipe.id, { competitor: 'shop', pageType: 'product', matchRules: { include: ['https://s.test/p/*'] } });
        await expect(submitVersion(api, ruled, version, 'once', 'me')).rejects.toMatchObject({ message: 'Not ready to submit. The match rules leave out 1 sample page: https://s.test/sale/2.' });
        expect(backend.log).toEqual([]);
    });

    it('sends the competitor, page type and match rules when it creates the recipe', async () => {
        const { api, backend, recipe, version } = await approved({ competitor: 'shop', pageType: 'product', matchRules: { include: ['https://s.test/*'] } });
        await testPages(recipe.id, version.digest);
        await submitVersion(api, recipe, version, 'once', 'me');
        expect(backend.recipes.get('rec-1')).toMatchObject({ competitor: 'shop', pageType: 'product' });
    });

    it('creates the recipe once, uploads with its approval, crawls, marks the version submitted and moves live', async () => {
        const { api, backend, recipe, version } = await approved();
        await testPages(recipe.id, version.digest);
        const crawl = await submitVersion(api, recipe, version, 'daily', 'me');

        const stored = (await pro.recipes.get(recipe.id))!;
        expect(stored).toMatchObject({ remoteId: 'rec-1', labels: { live: 1 } });
        expect((await pro.versions.get(recipe.id, 1))!.submittedAt).toBeGreaterThan(0);
        expect(crawl).toMatchObject({ crawlId: 'crawl-2', version: 1, schedule: 'daily' });
        expect(backend.recipes.get('rec-1')).toMatchObject({ live: 1 });
        expect(backend.log).toEqual(['POST /recipes', 'POST /recipes/rec-1/versions', 'POST /recipes/rec-1/versions/1/review', 'POST /recipes/rec-1/crawls', 'POST /recipes/rec-1/labels/live']);
        expect(backend.recipes.get('rec-1')!.versions.get(1)!.review).toEqual({ state: 'approved', by: 'reviewer', note: 'checked' });

        // A second submit of the same version: no new backend recipe, the upload is a no-op.
        await submitVersion(api, stored, version, 'once', 'me');
        expect(backend.recipes.size).toBe(1);
        expect(backend.recipes.get('rec-1')!.versions.size).toBe(1);
        expect(await pro.crawls.list(recipe.id)).toHaveLength(2);
    });

    it('refreshes each crawl\'s status and keeps it', async () => {
        const { api, recipe, version } = await approved();
        await testPages(recipe.id, version.digest);
        await submitVersion(api, recipe, version, 'once', 'me');
        await refreshCrawls(api, recipe.id);
        const [crawl] = await refreshCrawls(api, recipe.id);
        expect(crawl.last).toMatchObject({ status: 'running', pagesDone: 1 });
        expect(crawl.checkedAt).toBeGreaterThan(0);
    });
});
