import { describe, expect, it } from 'vitest';
import { createMockBackend, mockFetch, type MockBackend } from '../backend/mock';
import { outputDigest, specDigest } from '../recipe/canonical';
import { writeRecipeFile } from '../recipe/file';
import type { PageRecipeSpec, ProRecipe, Version } from '../recipe/types';
import { createRecipeStore } from './store';

const BASE = 'https://store.test';
const spec = (selector: string): PageRecipeSpec => ({ kind: 'page', steps: [{ kind: 'field', field: { id: 'f1', name: 'title', type: 'text', read: 'text', ways: [{ id: 'w1', addedIn: 1, kind: 'selector', selector }], ops: [] } }] });
const recipe: ProRecipe = { id: 'local', name: 'Acme product', site: 'acme.test', kind: 'page', latestVersion: 1, labels: {}, createdAt: 0, updatedAt: 0 };

/** A recipe on the mock, its versions uploaded, the given one approved and live. */
async function publish(backend: MockBackend, competitor: string, pageType: string, selectors: string[], live: number, matchRules?: { include: string[] }) {
    const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
        backend.handle({ method, path, headers: { authorization: 'Bearer dev-token', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const { id } = call('POST', '/recipes', { name: 'R', site: 'acme.test', kind: 'page', competitor, pageType, matchRules }).body as { id: string };
    const digests: string[] = [];
    for (const [i, selector] of selectors.entries()) {
        const s = spec(selector);
        const digest = await specDigest(s);
        const v: Version = { recipeId: 'local', version: i + 1, spec: s, settings: {}, pages: { kind: 'urls', urls: [] }, output: {}, digest, outputDigest: await outputDigest(s), origin: 'built', note: '', author: 'a', createdAt: 0 };
        call('POST', `/recipes/${id}/versions`, writeRecipeFile(recipe, [v], []), { 'idempotency-key': digest });
        digests.push(digest);
    }
    call('POST', `/recipes/${id}/versions/${live}/review`, { state: 'approved', by: 'reviewer', note: '' });
    call('POST', `/recipes/${id}/labels/live`, { version: live, reason: 'ship' });
    return { id, digests };
}

const job = (url: string, extra = {}) => ({ jobId: 'j', url, competitor: 'acme', pageType: 'product', ...extra });

describe('recipe store client', () => {
    it('resolves the live, approved version for a page, and verifies its digest', async () => {
        const backend = createMockBackend();
        const { id, digests } = await publish(backend, 'acme', 'product', ['h1', 'h1.title'], 2);
        const store = createRecipeStore({ baseUrl: BASE, token: 'dev-token', fetch: mockFetch(backend, BASE) });
        const r = await store.recipeFor(job('https://acme.test/p/1'));
        expect(r).toMatchObject({ recipeId: id, version: 2, digest: digests[1] });
        expect(r.spec).toEqual(spec('h1.title'));
    });

    it('chooses between recipes of one competitor and page type by their match rules', async () => {
        const backend = createMockBackend();
        const sale = await publish(backend, 'acme', 'product', ['.sale h1'], 1, { include: ['https://acme.test/sale/*'] });
        const plain = await publish(backend, 'acme', 'product', ['h1'], 1);
        const store = createRecipeStore({ baseUrl: BASE, token: 'dev-token', fetch: mockFetch(backend, BASE) });
        expect((await store.recipeFor(job('https://acme.test/sale/9'))).recipeId).toBe(sale.id);
        expect((await store.recipeFor(job('https://acme.test/p/9'))).recipeId).toBe(plain.id);
    });

    it('caches a resolve for its TTL and a version for good', async () => {
        let t = 0;
        const backend = createMockBackend();
        await publish(backend, 'acme', 'product', ['h1'], 1);
        const store = createRecipeStore({ baseUrl: BASE, token: 'dev-token', fetch: mockFetch(backend, BASE), now: () => t, resolveTtlMs: 60_000 });
        await store.recipeFor(job('https://acme.test/p/1'));
        await store.recipeFor(job('https://acme.test/p/1'));
        t = 60_001;
        await store.recipeFor(job('https://acme.test/p/1'));
        const gets = backend.log.filter(l => l.startsWith('GET')).map(l => l.split('?')[0].split('/').slice(0, 2).join('/'));
        expect(gets).toEqual(['GET /resolve', 'GET /versions', 'GET /resolve']);
    });

    it('says no_recipe, refuses a pinned unapproved version in production, and classes a store failure', async () => {
        const backend = createMockBackend();
        const { digests } = await publish(backend, 'acme', 'product', ['h1', 'h2'], 1);
        const store = createRecipeStore({ baseUrl: BASE, token: 'dev-token', fetch: mockFetch(backend, BASE) });
        await expect(store.recipeFor(job('https://acme.test/p/1', { pageType: 'listing' }))).rejects.toMatchObject({ errorClass: 'no_recipe' });
        await expect(store.recipeFor(job('https://acme.test/p/1', { recipeDigest: digests[1] }))).rejects.toMatchObject({ errorClass: 'no_recipe', message: expect.stringContaining('not approved') });
        expect((await store.recipeFor(job('https://acme.test/p/1', { recipeDigest: digests[1], mode: 'test' }))).version).toBe(2);
        backend.failNext(503);
        await expect(store.recipeFor(job('https://acme.test/other'))).rejects.toMatchObject({ errorClass: 'recipe_store' });
    });
});
