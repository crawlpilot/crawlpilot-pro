/**
 * The mock crawler backend (`mock.ts`) on an HTTP port, with CORS as a real API sends: what the e2e harness
 * runs, and what a developer runs to use Pro and the crawler worker locally (`npm run pro:mock`,
 * `docs/onboarding/running-locally.md`). State is in memory: it is gone when the server stops.
 */
import { createServer } from 'node:http';
import { specDigest } from '../recipe/canonical';
import type { PageRecipeSpec, ProSpec } from '../recipe/types';
import { createMockBackend, type MockBackend } from './mock';

export interface MockServer {
    origin: string;
    backend: MockBackend;
    close: () => void;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, idempotency-key', 'access-control-allow-methods': 'GET, POST' };

export async function startMockServer(o: { port?: number; host?: string; token?: string; onRequest?: (line: string) => void } = {}): Promise<MockServer> {
    const backend = createMockBackend(o.token);
    const server = createServer((req, res) => {
        if (req.method === 'OPTIONS') { res.writeHead(204, CORS).end(); return; }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
            const out = backend.handle({ method: req.method ?? 'GET', path: req.url ?? '/', headers, body });
            o.onRequest?.(`${out.status} ${req.method} ${req.url}`);
            res.writeHead(out.status, { ...CORS, 'content-type': 'application/json' }).end(JSON.stringify(out.body));
        });
    });
    const host = o.host ?? '127.0.0.1';
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(o.port ?? 0, host, () => resolve()); });
    const { port } = server.address() as { port: number };
    return { origin: `http://${host}:${port}`, backend, close: () => server.close() };
}

/** The demo recipe (`MOCK_SEED=demo`): the lamp page of the e2e site (`e2e/site/product.html`), title and price. */
export const DEMO_SPEC: PageRecipeSpec = { kind: 'page', steps: [
    { kind: 'field', field: { id: 'f-title', name: 'title', type: 'text', read: 'text', ops: [], ways: [
        { id: 'w-title-old', addedIn: 1, kind: 'selector', selector: 'h1.lamp-name' },
        { id: 'w-title', addedIn: 1, kind: 'selector', selector: 'h1.product-title' },
    ] } },
    { kind: 'field', field: { id: 'f-price', name: 'price', type: 'text', read: 'text', ops: [], ways: [{ id: 'w-price', addedIn: 1, kind: 'selector', selector: '.product-price' }] } },
] };

/** A recipe to seed the mock with (`MOCK_SEED=<file>`): what it is for, and its spec. */
export interface SeedRecipe {
    name: string;
    site: string;
    competitor: string;
    pageType: string;
    matchRules?: { include: string[]; exclude?: string[] };
    spec: ProSpec;
}

/**
 * Publishes the demo recipe as Pro would (upload, approval by a second person, `live`) for competitor `demo`,
 * page type `product`, so the crawler worker has something to resolve without clicking through Pro first.
 */
export function seedDemo(backend: MockBackend, token = 'dev-token'): Promise<{ recipeId: string; digest: string }> {
    return seedRecipe(backend, { name: 'Demo lamps', site: '127.0.0.1', competitor: 'demo', pageType: 'product', spec: DEMO_SPEC }, token);
}

/** Publishes a recipe as Pro would: upload, approval by a second person, `live`. */
export async function seedRecipe(backend: MockBackend, seed: SeedRecipe, token = 'dev-token'): Promise<{ recipeId: string; digest: string }> {
    const { spec } = seed;
    const digest = await specDigest(spec);
    const call = (method: string, path: string, body: unknown, headers: Record<string, string> = {}) => {
        const out = backend.handle({ method, path, headers: { authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });
        if (out.status >= 300) throw new Error(`${method} ${path}: ${out.status} ${JSON.stringify(out.body)}`);
        return out.body as { id?: string };
    };
    const recipe = { name: seed.name, site: seed.site, kind: spec.kind, competitor: seed.competitor, pageType: seed.pageType, ...(seed.matchRules ? { matchRules: seed.matchRules } : {}) };
    const { id } = call('POST', '/recipes', recipe);
    const recipeId = id!;
    call('POST', `/recipes/${recipeId}/versions`, {
        format: 3, recipe, labels: {}, samples: [],
        versions: [{ version: 1, spec, settings: {}, pages: { kind: 'urls', urls: [] }, output: {}, digest, origin: 'built', note: 'seeded', author: 'seed-author', createdAt: new Date(0).toISOString() }],
    }, { 'idempotency-key': digest });
    call('POST', `/recipes/${recipeId}/versions/1/review`, { state: 'approved', by: 'seed-reviewer', note: 'seeded' });
    call('POST', `/recipes/${recipeId}/labels/live`, { version: 1, reason: 'seeded' });
    return { recipeId, digest };
}
