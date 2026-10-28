import { describe, expect, it } from 'vitest';
import { createSearchSink, memorySink } from './search';

function fakeES(replies: (Response | Error)[]) {
    const calls: { url: string; headers: Record<string, string>; lines: unknown[] }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string>, lines: String(init.body).trim().split('\n').map(l => JSON.parse(l)) });
        const r = replies.shift() ?? new Response(JSON.stringify({ errors: false, items: [] }), { status: 200 });
        if (r instanceof Error) throw r;
        return r;
    }) as unknown as typeof globalThis.fetch;
    return { calls, fetch };
}
type BulkItem = Record<string, { status: number; error?: { type: string; reason: string } }>;
const ok = (items: BulkItem[] = []) => new Response(JSON.stringify({ errors: items.some(i => Object.values(i)[0].status >= 300), items }), { status: 200 });

describe('search sink', () => {
    it('sends a bulk: index with an id, create without, prefixed index names, and the API key', async () => {
        const es = fakeES([]);
        const sink = createSearchSink({ url: 'https://es.test/', apiKey: 'KEY', indexPrefix: 'p-', batchSize: 10 }, { fetch: es.fetch });
        sink.write('scrapes-acme', { a: 1 }, 'job-1');
        sink.write('crawl-requests-2026.10.28', { b: 2 });
        await sink.flush();
        expect(es.calls).toHaveLength(1);
        expect(es.calls[0].url).toBe('https://es.test/_bulk');
        expect(es.calls[0].headers).toMatchObject({ authorization: 'ApiKey KEY', 'content-type': 'application/x-ndjson' });
        expect(es.calls[0].lines).toEqual([
            { index: { _index: 'p-scrapes-acme', _id: 'job-1' } }, { a: 1 },
            { create: { _index: 'p-crawl-requests-2026.10.28' } }, { b: 2 },
        ]);
    });

    it('sends a full batch at once, tries again when Elasticsearch is down, and keeps what it could not send', async () => {
        const errors: string[] = [];
        const es = fakeES([new Response('', { status: 503 }), new Error('ECONNREFUSED'), ok(), new Response('', { status: 503 }), new Response('', { status: 503 }), new Response('', { status: 503 })]);
        const sink = createSearchSink({ url: 'https://es.test', batchSize: 2 }, { fetch: es.fetch, sleep: async () => {}, onError: m => errors.push(m) });
        sink.write('i', { n: 1 });
        sink.write('i', { n: 2 });
        await sink.flush();
        expect(es.calls).toHaveLength(3);
        expect(errors).toEqual([]);
        sink.write('i', { n: 3 });
        await sink.flush();
        expect(errors).toEqual(['bulk of 1 not sent: status 503']);
        await sink.flush();
        expect(es.calls[es.calls.length - 1].lines).toEqual([{ create: { _index: 'i' } }, { n: 3 }]);
    });

    it('puts items rejected with 429 back, and reports and drops other item errors', async () => {
        const errors: string[] = [];
        const es = fakeES([ok([{ create: { status: 201 } }, { create: { status: 429 } }, { index: { status: 400, error: { type: 'mapper_parsing_exception', reason: 'bad price' } } }])]);
        const sink = createSearchSink({ url: 'https://es.test', batchSize: 10 }, { fetch: es.fetch, onError: m => errors.push(m) });
        sink.write('i', { n: 1 });
        sink.write('i', { n: 2 });
        sink.write('s', { n: 3 }, 'x');
        await sink.flush();
        expect(errors).toEqual(['s: mapper_parsing_exception bad price']);
        await sink.flush();
        expect(es.calls[1].lines).toEqual([{ create: { _index: 'i' } }, { n: 2 }]);
    });

    it('drops the oldest documents when the buffer is full, and says so', () => {
        const errors: string[] = [];
        const sink = createSearchSink({ url: 'https://es.test', batchSize: 100, maxBuffer: 2 }, { fetch: fakeES([]).fetch, onError: m => errors.push(m) });
        for (let n = 0; n < 3; n++) sink.write('i', { n });
        expect(errors).toEqual(['buffer full: 1 oldest documents dropped']);
    });

    it('memory sink replaces by id', () => {
        const sink = memorySink();
        sink.write('i', { v: 1 }, 'a');
        sink.write('i', { v: 2 }, 'a');
        sink.write('i', { v: 3 });
        expect(sink.docs.get('i')).toEqual([{ doc: { v: 2 }, id: 'a' }, { doc: { v: 3 } }]);
    });
});
