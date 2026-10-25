import { describe, expect, it } from 'vitest';
import { createClient } from './client';
import { createMockBackend, mockFetch } from './mock';
import { BackendError } from './types';

const BASE = 'https://crawler.test/api';
const file = (version: number) => JSON.stringify({ format: 2, recipe: { name: 'R', site: 's', kind: 'page' }, versions: [{ version, spec: { kind: 'page', steps: [{ kind: 'field', field: { name: 'title' } }] } }] });

function setup(token = 'dev-token') {
    const backend = createMockBackend();
    const waits: number[] = [];
    const api = createClient({ baseUrl: `${BASE}/`, token, fetch: mockFetch(backend, BASE), sleep: async ms => { waits.push(ms); } });
    return { backend, api, waits };
}

describe('backend client', () => {
    it('creates a recipe, uploads a version once, crawls it and reads the crawl', async () => {
        const { api, backend } = setup();
        const { id } = await api.createRecipe({ name: 'R', site: 's', kind: 'page' });
        expect(await api.uploadVersion(id, file(2), 'digest-2')).toEqual({ version: 2, accepted: true });
        expect(await api.uploadVersion(id, file(2), 'digest-2')).toEqual({ version: 2, accepted: true });
        expect(backend.recipes.get(id)!.versions.size).toBe(1);

        const { crawlId } = await api.startCrawl(id, { version: 2, pages: { kind: 'urls', urls: ['a', 'b'] }, schedule: 'daily' });
        expect((await api.getCrawl(crawlId)).status).toBe('queued');
        expect((await api.getCrawl(crawlId)).status).toBe('running');
        expect(await api.getCrawl(crawlId)).toMatchObject({ status: 'done', pagesDone: 2, fields: [{ name: 'title', fill: 1 }] });
        expect(await api.setLive(id, 2, 'ship')).toEqual({ live: 2 });
        expect(backend.log[0]).toBe('POST /recipes');
    });

    it('tries again on 5xx and 429, then gives up as unavailable', async () => {
        const { api, backend, waits } = setup();
        backend.failNext(503, 2);
        await expect(api.createRecipe({ name: 'R', site: 's', kind: 'page' })).resolves.toEqual({ id: 'rec-1' });
        expect(waits).toEqual([500, 1000]);

        backend.failNext(429, 3);
        await expect(api.createRecipe({ name: 'R', site: 's', kind: 'page' })).rejects.toMatchObject({ kind: 'unavailable', status: 429 });
    });

    it('says auth, invalid and conflict plainly, without retrying them', async () => {
        const bad = setup('wrong');
        const e = await bad.api.createRecipe({ name: 'R', site: 's', kind: 'page' }).catch(x => x);
        expect(e).toBeInstanceOf(BackendError);
        expect(e).toMatchObject({ kind: 'auth', message: 'Sign in again: the token was not accepted.' });
        expect(bad.waits).toEqual([]);

        const { api } = setup();
        const { id } = await api.createRecipe({ name: 'R', site: 's', kind: 'page' });
        await expect(api.uploadVersion(id, '{"format":1}', 'd')).rejects.toMatchObject({ kind: 'invalid', details: ['$.versions[0].spec is missing'] });
        await expect(api.startCrawl(id, { version: 9, pages: { kind: 'urls', urls: [] }, schedule: 'once' })).rejects.toMatchObject({ kind: 'conflict' });
    });

    it('a backend it cannot reach is unavailable after three tries', async () => {
        const waits: number[] = [];
        const offline = createClient({ baseUrl: 'https://elsewhere.test', token: 't', fetch: mockFetch(createMockBackend(), BASE), sleep: async ms => { waits.push(ms); } });
        await expect(offline.getCrawl('x')).rejects.toMatchObject({ kind: 'unavailable', message: expect.stringContaining('could not be reached') });
        expect(waits).toEqual([500, 1000]);
    });
});
