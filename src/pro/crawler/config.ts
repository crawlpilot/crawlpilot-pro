/**
 * The worker's configuration: a JSON file where `${NAME}` in any string is replaced by the environment
 * variable, so proxy passwords, the store token and the Elasticsearch key stay out of the file.
 * Sites are matched by host suffix (`zara.com` covers `www.zara.com`); the longest match wins, then
 * `default`. A site's profile sets its pacing, proxy pool and country, how its pages render (locale,
 * timezone, viewport, user agent) and whether robots.txt is respected.
 */
import { readFile } from 'node:fs/promises';
import { DEFAULT_SITE_POLICY, type SitePolicy } from './governor';
import type { ProxyConfig } from './proxies';
import { DEFAULT_RETRY, type RetryPolicy } from './retry';
import type { SearchConfig } from './search';
import type { SqsConfig } from './sqs';

export interface SiteProfile extends Partial<SitePolicy> {
    /** A key of `proxyPools`; none means a direct connection. */
    proxyPool?: string;
    proxyCountry?: string;
    locale?: string;
    timezoneId?: string;
    viewport?: { width: number; height: number };
    userAgent?: string;
    extraHeaders?: Record<string, string>;
    respectRobots?: boolean;
    /** Resource types not loaded, to save bandwidth (`image`, `media`, `font`). */
    blockResources?: string[];
}

export interface CrawlerConfig {
    workerId: string;
    /** Pages this worker reads at once, over all sites. */
    concurrency: number;
    /** The token robots.txt groups are matched against. */
    robotsAgent: string;
    navigationTimeoutMs: number;
    /** Extra wait after `load`, for pages that render late. */
    settleMs: number;
    /** A browser context serves this many pages before it is replaced. */
    pagesPerContext: number;
    /** A context unused this long is closed; past `maxContexts`, the least recently used idle ones are. */
    contextIdleMs: number;
    maxContexts: number;
    /** A list is read to this many pages at most: clicked through in one job, or followed as jobs. */
    maxListPages: number;
    /** A list row's details page is crawled as a job of its own. */
    followDetails: boolean;
    retry: RetryPolicy;
    sites: { default: SiteProfile } & Record<string, SiteProfile>;
    proxyPools: Record<string, ProxyConfig[]>;
    recipeStore: { url: string; token: string };
    search: SearchConfig;
    /** Jobs from SQS; without it, the command line reads a file of jobs (`--jobs`). */
    queue?: { type: 'sqs' } & SqsConfig;
}

export const DEFAULTS: Omit<CrawlerConfig, 'recipeStore' | 'search'> = {
    workerId: 'worker-1',
    concurrency: 4,
    robotsAgent: 'CrawlPilotBot',
    navigationTimeoutMs: 30_000,
    settleMs: 500,
    pagesPerContext: 50,
    contextIdleMs: 5 * 60_000,
    maxContexts: 50,
    maxListPages: 20,
    followDetails: true,
    retry: DEFAULT_RETRY,
    sites: { default: { respectRobots: true } },
    proxyPools: {},
};

function substitute(value: unknown, env: Record<string, string | undefined>): unknown {
    if (typeof value === 'string') {
        return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
            const v = env[name];
            if (v === undefined) throw new Error(`The configuration needs the environment variable ${name}.`);
            return v;
        });
    }
    if (Array.isArray(value)) return value.map(v => substitute(v, env));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, env)]));
    return value;
}

export function parseConfig(json: unknown, env: Record<string, string | undefined> = process.env): CrawlerConfig {
    const raw = substitute(json, env) as Partial<CrawlerConfig>;
    if (!raw.recipeStore?.url || !raw.recipeStore.token) throw new Error('The configuration needs recipeStore.url and recipeStore.token.');
    if (!raw.search?.url) throw new Error('The configuration needs search.url.');
    const config: CrawlerConfig = {
        ...DEFAULTS, ...raw,
        retry: { ...DEFAULTS.retry, ...raw.retry },
        sites: { ...DEFAULTS.sites, ...raw.sites, default: { ...DEFAULTS.sites.default, ...raw.sites?.default } },
        proxyPools: raw.proxyPools ?? {},
    } as CrawlerConfig;
    for (const [host, site] of Object.entries(config.sites)) {
        if (site.proxyPool && !config.proxyPools[site.proxyPool]?.length) throw new Error(`Site ${host} uses proxy pool "${site.proxyPool}", which has no proxies.`);
    }
    if (config.queue && (config.queue.type !== 'sqs' || !config.queue.url || !config.queue.deadLetterUrl)) {
        throw new Error('queue needs type "sqs", url and deadLetterUrl.');
    }
    if (config.queue && [config.queue.url, config.queue.deadLetterUrl].some(u => u.endsWith('.fifo'))) {
        throw new Error('queue: FIFO queues are not supported, use standard queues.');
    }
    const ids = Object.values(config.proxyPools).flat().map(p => p.id);
    const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dupe) throw new Error(`Proxy id "${dupe}" is used twice.`);
    return config;
}

export async function loadConfig(path: string, env = process.env): Promise<CrawlerConfig> {
    return parseConfig(JSON.parse(await readFile(path, 'utf8')), env);
}

/** The profile for a host: the longest matching site key, over `default`. */
export function siteProfile(config: CrawlerConfig, host: string): SiteProfile {
    const key = Object.keys(config.sites).filter(k => k !== 'default' && (host === k || host.endsWith(`.${k}`))).sort((a, b) => b.length - a.length)[0];
    return { ...config.sites.default, ...(key ? config.sites[key] : {}) };
}

export function sitePolicy(config: CrawlerConfig, host: string): SitePolicy {
    const p = siteProfile(config, host);
    const pick = <K extends keyof SitePolicy>(k: K) => (p[k] ?? DEFAULT_SITE_POLICY[k]) as SitePolicy[K];
    return {
        minDelayMs: pick('minDelayMs'), maxDelayMs: pick('maxDelayMs'), concurrency: pick('concurrency'),
        cooldownBaseMs: pick('cooldownBaseMs'), cooldownMaxMs: pick('cooldownMaxMs'), blockAfter: pick('blockAfter'),
    };
}
