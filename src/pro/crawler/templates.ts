/**
 * Index templates for what the worker writes, so each field has the type its queries need: ids, classes
 * and hosts as keywords (filters, terms aggregations), timings and sizes as numbers, URLs and messages also
 * searchable as text, and selector usage `nested`, so tried / matched / won add up per selector id.
 * `installTemplates` puts them (`PUT _index_template/<name>`); run it once per cluster, and again after a
 * change (`node worker.mjs --config crawler.json --setup-elasticsearch`). The same API works on OpenSearch.
 */
import type { SearchConfig } from './search';

const keyword = { type: 'keyword', ignore_above: 1024 };
const text = { type: 'text', fields: { raw: { type: 'keyword', ignore_above: 2048 } } };
/** Strings not mapped below are keywords: header values, meta, attribute values. */
const stringsAsKeywords = [{ strings: { match_mapping_type: 'string', mapping: keyword } }];
const recipe = { properties: { recipeId: keyword, version: { type: 'integer' }, digest: keyword } };

export const TEMPLATES: Record<string, { patterns: string[]; mappings: object }> = {
    'crawl-requests': {
        patterns: ['crawl-requests-*'],
        mappings: {
            dynamic_templates: stringsAsKeywords,
            properties: {
                '@timestamp': { type: 'date' },
                jobId: keyword, runId: keyword, attempt: { type: 'short' }, final: { type: 'boolean' }, outcome: keyword,
                url: text, finalUrl: text, host: keyword, competitor: keyword, pageType: keyword, mode: keyword, worker: keyword,
                proxyId: keyword, proxyCountry: keyword,
                status: { type: 'short' }, headers: { type: 'object' }, headerNames: keyword, requestHeaders: { type: 'object' }, redirects: keyword,
                timings: { properties: { totalMs: { type: 'long' }, navigationMs: { type: 'long' }, extractMs: { type: 'long' } } },
                bytes: { type: 'long' },
                errorClass: keyword, errorMessage: text, blockSignal: keyword, retryAfterMs: { type: 'long' }, nextAttemptInMs: { type: 'long' },
                recipe, fieldsFilled: { type: 'short' }, fieldsTotal: { type: 'short' },
            },
        },
    },
    'crawl-sites': {
        patterns: ['crawl-sites-*'],
        mappings: {
            properties: {
                '@timestamp': { type: 'date' }, host: keyword, competitor: keyword, worker: keyword, state: keyword, reason: text,
                consecutiveBlocks: { type: 'short' }, delayMs: { type: 'long' }, cooldownUntil: { type: 'date' },
            },
        },
    },
    scrapes: {
        patterns: ['scrapes-*', 'test-scrapes-*'],
        mappings: {
            dynamic_templates: stringsAsKeywords,
            properties: {
                jobId: keyword, runId: keyword, url: text, finalUrl: text, competitor: keyword, pageType: keyword, mode: keyword,
                crawledAt: { type: 'date' }, pageStatus: keyword, ...recipe.properties,
                // Values differ by recipe (a price is text in one, money in another): kept, not indexed.
                attributes: { type: 'object', enabled: false },
                fieldStatus: { type: 'object' }, meta: { type: 'object' },
            },
        },
    },
    'selector-usage': {
        patterns: ['selector-usage-*', 'test-selector-usage-*'],
        mappings: {
            properties: {
                jobId: keyword, crawledAt: { type: 'date' }, competitor: keyword, pageType: keyword, pageStatus: keyword, ...recipe.properties,
                ways: { type: 'nested', properties: { field: keyword, wayId: keyword, tried: { type: 'boolean' }, matched: { type: 'boolean' }, won: { type: 'boolean' } } },
            },
        },
    },
};

/** Puts every template, its patterns under the config's index prefix. Throws on the first refusal. */
export async function installTemplates(cfg: SearchConfig, doFetch: typeof fetch = (...a) => fetch(...a)): Promise<string[]> {
    const root = cfg.url.replace(/\/+$/, '');
    const prefix = cfg.indexPrefix ?? '';
    const auth = cfg.apiKey ? `ApiKey ${cfg.apiKey}`
        : cfg.username ? `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64')}` : undefined;
    const done: string[] = [];
    for (const [name, t] of Object.entries(TEMPLATES)) {
        const id = `${prefix}crawlpilot-${name}`;
        const res = await doFetch(`${root}/_index_template/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
            body: JSON.stringify({ index_patterns: t.patterns.map(p => `${prefix}${p}`), priority: 200, template: { mappings: t.mappings } }),
        });
        if (!res.ok) throw new Error(`Template ${id} refused: ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
        done.push(id);
    }
    return done;
}
