import { describe, expect, it } from 'vitest';
import { installTemplates, TEMPLATES } from './templates';

describe('index templates', () => {
    it('are put under the index prefix, with usage nested per selector', async () => {
        const calls: { url: string; method?: string; body: any }[] = [];
        const fetch = (async (url: string, init: RequestInit) => {
            calls.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
            return new Response('{"acknowledged":true}', { status: 200 });
        }) as unknown as typeof globalThis.fetch;
        const ids = await installTemplates({ url: 'https://es.test', indexPrefix: 'stage-' }, fetch);
        expect(ids).toEqual(Object.keys(TEMPLATES).map(n => `stage-crawlpilot-${n}`));
        const usage = calls.find(c => c.url.endsWith('stage-crawlpilot-selector-usage'))!;
        expect(usage.method).toBe('PUT');
        expect(usage.body.index_patterns).toEqual(['stage-selector-usage-*', 'stage-test-selector-usage-*']);
        expect(usage.body.template.mappings.properties.ways.type).toBe('nested');
    });

    it('stop on a refusal and say which', async () => {
        const fetch = (async () => new Response('bad mapping', { status: 400 })) as unknown as typeof globalThis.fetch;
        await expect(installTemplates({ url: 'https://es.test' }, fetch)).rejects.toThrow('crawlpilot-crawl-requests refused: 400 bad mapping');
    });
});
