// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_SPEC, seedDemo, startMockServer, type MockServer } from './mockServer';
import { specDigest } from '../recipe/canonical';

let server: MockServer | undefined;
afterEach(() => server?.close());

describe('mock backend server', () => {
    it('serves the mock over HTTP with CORS, and the demo seed is live for the worker to resolve', async () => {
        const lines: string[] = [];
        server = await startMockServer({ onRequest: l => lines.push(l) });
        const { recipeId, digest } = await seedDemo(server.backend);
        expect(digest).toBe(await specDigest(DEMO_SPEC));

        const auth = { authorization: 'Bearer dev-token' };
        const url = encodeURIComponent('http://127.0.0.1:8000/site/product.html?id=3');
        const resolved = await fetch(`${server.origin}/resolve?competitor=demo&pageType=product&url=${url}`, { headers: auth });
        expect(resolved.headers.get('access-control-allow-origin')).toBe('*');
        expect(await resolved.json()).toEqual({ recipeId, version: 1, digest });
        const version = await (await fetch(`${server.origin}/versions/${digest}`, { headers: auth })).json();
        expect(version).toMatchObject({ recipeId, version: 1, approved: true });

        expect((await fetch(`${server.origin}/resolve?competitor=demo&pageType=product&url=${url}`)).status).toBe(401);
        expect((await fetch(`${server.origin}/recipes`, { method: 'OPTIONS' })).status).toBe(204);
        expect(lines[0]).toMatch(/^200 GET \/resolve\?/);
    });
});
