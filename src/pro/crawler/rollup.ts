/**
 * One day's selector usage added up per recipe and way: `selector-usage-daily-YYYY`, one document per recipe,
 * way and day, id `recipeId:wayId:date`, so a rerun replaces it. Only pages that loaded count (`pageStatus:
 * ok`), and test-mode crawls are left out. These are the days the recipe store's `/ways/stats` returns and
 * Pro labels each selector from (`recipe/wayHealth.ts`). Run it once a day, after midnight UTC:
 * `node worker.mjs --config crawler.json --rollup` (yesterday) or `--rollup 2026-10-27`.
 */
import { createSearchSink, type SearchConfig } from './search';

export interface DailyWay {
    date: string;
    recipeId: string;
    competitor: string;
    pageType: string;
    field: string;
    wayId: string;
    /** Pages counted. */
    pages: number;
    tried: number;
    matched: number;
    won: number;
}

interface Bucket { key: { recipeId: string; competitor: string; pageType: string }; ways: { way: { buckets: WayBucket[] } } }
interface WayBucket { key: string; doc_count: number; field: { buckets: { key: string }[] }; tried: { doc_count: number }; matched: { doc_count: number }; won: { doc_count: number } }

const PAGE = 500;

export const dailyIndex = (date: string) => `selector-usage-daily-${date.slice(0, 4)}`;

function query(date: string, after?: object) {
    const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    return {
        size: 0,
        query: { bool: { filter: [{ range: { crawledAt: { gte: `${date}T00:00:00Z`, lt: `${next}T00:00:00Z` } } }, { term: { pageStatus: 'ok' } }] } },
        aggs: {
            recipes: {
                composite: {
                    size: PAGE,
                    sources: [{ recipeId: { terms: { field: 'recipeId' } } }, { competitor: { terms: { field: 'competitor' } } }, { pageType: { terms: { field: 'pageType' } } }],
                    ...(after ? { after } : {}),
                },
                aggs: {
                    ways: {
                        nested: { path: 'ways' },
                        aggs: {
                            way: {
                                terms: { field: 'ways.wayId', size: 10_000 },
                                aggs: {
                                    field: { terms: { field: 'ways.field', size: 1 } },
                                    tried: { filter: { term: { 'ways.tried': true } } },
                                    matched: { filter: { term: { 'ways.matched': true } } },
                                    won: { filter: { term: { 'ways.won': true } } },
                                },
                            },
                        },
                    },
                },
            },
        },
    };
}

/** The day's totals, read page by page from Elasticsearch. */
export async function dailyUsage(cfg: SearchConfig, date: string, doFetch: typeof fetch = (...a) => fetch(...a)): Promise<DailyWay[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Not a date: ${date} (YYYY-MM-DD)`);
    const root = cfg.url.replace(/\/+$/, '');
    const auth = cfg.apiKey ? `ApiKey ${cfg.apiKey}`
        : cfg.username ? `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64')}` : undefined;
    const index = `${cfg.indexPrefix ?? ''}selector-usage-${date.slice(0, 7).replace('-', '.')}`;
    const out: DailyWay[] = [];
    let after: object | undefined;
    do {
        const res = await doFetch(`${root}/${encodeURIComponent(index)}/_search`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
            body: JSON.stringify(query(date, after)),
        });
        if (res.status === 404) return out; // No crawls that month.
        if (!res.ok) throw new Error(`Usage for ${date} not read: ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
        const body = await res.json() as { aggregations?: { recipes: { buckets: Bucket[]; after_key?: object } } };
        const recipes = body.aggregations?.recipes;
        for (const b of recipes?.buckets ?? []) {
            for (const w of b.ways.way.buckets) {
                out.push({
                    date, ...b.key, field: w.field.buckets[0]?.key ?? '', wayId: w.key,
                    pages: w.doc_count, tried: w.tried.doc_count, matched: w.matched.doc_count, won: w.won.doc_count,
                });
            }
        }
        after = recipes && recipes.buckets.length === PAGE ? recipes.after_key : undefined;
    } while (after);
    return out;
}

/** Reads the day and writes its totals; returns how many way-days were written. */
export async function rollupDay(cfg: SearchConfig, date: string, doFetch?: typeof fetch): Promise<number> {
    const days = await dailyUsage(cfg, date, doFetch);
    const sink = createSearchSink(cfg, { ...(doFetch ? { fetch: doFetch } : {}), onError: m => { throw new Error(m); } });
    for (const d of days) sink.write(dailyIndex(date), d, `${d.recipeId}:${d.wayId}:${d.date}`);
    await sink.close();
    return days.length;
}

/** Yesterday, in UTC. */
export const yesterday = (now = Date.now()) => new Date(now - 86_400_000).toISOString().slice(0, 10);
