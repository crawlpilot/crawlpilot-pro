import { describe, expect, it } from 'vitest';
import { parseConfig, siteProfile, sitePolicy } from './config';
import example from './crawler.example.json';

const base = {
    recipeStore: { url: 'https://store.test', token: '${STORE_TOKEN}' },
    search: { url: 'https://es.test', apiKey: '${ES_KEY}' },
    proxyPools: { de: [{ id: 'de-1', server: 'http://proxy.test:8000', username: 'u', password: '${PROXY_PASS}' }] },
    sites: {
        default: { minDelayMs: 3000 },
        'zara.com': { proxyPool: 'de', proxyCountry: 'DE', locale: 'de-DE', concurrency: 1 },
        'shop.zara.com': { respectRobots: false },
    },
};
const env = { STORE_TOKEN: 't', ES_KEY: 'k', PROXY_PASS: 'secret' };

describe('crawler config', () => {
    it('fills ${NAME} from the environment, and says which one is missing', () => {
        const c = parseConfig(base, env);
        expect(c.recipeStore.token).toBe('t');
        expect(c.proxyPools.de[0].password).toBe('secret');
        expect(c.retry.maxAttempts).toBe(4);
        expect(() => parseConfig(base, { ...env, PROXY_PASS: undefined })).toThrow('PROXY_PASS');
    });

    it('matches sites by host suffix, the longest first, over the default', () => {
        const c = parseConfig(base, env);
        expect(siteProfile(c, 'www.zara.com')).toMatchObject({ proxyPool: 'de', locale: 'de-DE', minDelayMs: 3000, respectRobots: true });
        expect(siteProfile(c, 'shop.zara.com')).toMatchObject({ respectRobots: false, minDelayMs: 3000 });
        expect(siteProfile(c, 'notzara.com')).not.toHaveProperty('proxyPool');
        expect(sitePolicy(c, 'www.zara.com')).toMatchObject({ minDelayMs: 3000, concurrency: 1, blockAfter: 3 });
    });

    it('refuses a site on an empty pool, and a proxy id used twice', () => {
        expect(() => parseConfig({ ...base, sites: { default: {}, 'x.com': { proxyPool: 'nope' } } }, env)).toThrow('"nope"');
        expect(() => parseConfig({ ...base, sites: { default: {} }, proxyPools: { a: [{ id: 'p', server: 's' }], b: [{ id: 'p', server: 's' }] } }, env)).toThrow('"p" is used twice');
    });

    it('reads the example configuration', () => {
        const c = parseConfig(example, { PROXY_EU_PASSWORD: 'p', RECIPE_STORE_TOKEN: 't', ELASTIC_API_KEY: 'k' });
        expect(siteProfile(c, 'www.zara.com')).toMatchObject({ proxyPool: 'eu-residential', proxyCountry: 'DE', locale: 'de-DE', concurrency: 1 });
    });
});
