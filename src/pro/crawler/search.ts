/**
 * Writes documents to Elasticsearch (or OpenSearch: the `_bulk` API is the same) in batches.
 * - A document with an id is indexed (a redelivered job overwrites its scrape); one without (request and
 *   site events) is given an id when written and created: a bulk sent again after a timeout (Elasticsearch
 *   had it after all) finds it there (409) instead of adding it twice.
 * - A batch is sent when it is full or `flushMs` after the first document, whichever comes first.
 * - Elasticsearch down or 429: the batch is tried again with a backoff; items it rejects with 429 go back
 *   in the buffer; other item errors (a mapping conflict) are reported and dropped.
 * - The buffer is capped: when Elasticsearch stays away, the oldest documents are dropped and reported.
 *   Crawling never waits on telemetry.
 * - `writeConfirmed` is for what a job must not lose (its scrape and usage documents): it says when the
 *   document is in, or that it was dropped, so the job is acknowledged only once its results are safe.
 * - Every request has a timeout; `close` sends what is left until its deadline, then says what it leaves.
 */
import { randomUUID } from 'node:crypto';

export interface SearchConfig {
    url: string;
    /** `Authorization: ApiKey …`, or basic auth with `username` and `password`. */
    apiKey?: string;
    username?: string;
    password?: string;
    /** Put in front of every index name ("crawl-"). */
    indexPrefix?: string;
    batchSize?: number;
    flushMs?: number;
    maxBuffer?: number;
    /** One bulk request, before it counts as failed. */
    timeoutMs?: number;
}

export interface SearchSink {
    /** Queues a document; `id` makes it replace the one with the same id. */
    write(index: string, doc: object, id?: string): void;
    /** As `write`; resolves once Elasticsearch has the document, rejects when it is dropped. */
    writeConfirmed(index: string, doc: object, id: string): Promise<void>;
    flush(): Promise<void>;
    /** Sends what is buffered, for at most `deadlineMs`. */
    close(deadlineMs?: number): Promise<void>;
}

interface Item { index: string; doc: object; id: string; create: boolean; confirm?: { resolve(): void; reject(e: Error): void } }

const drop = (items: Item[], why: string) => { for (const i of items) i.confirm?.reject(new Error(why)); };

const TRIES = 3;

export function createSearchSink(cfg: SearchConfig, deps: {
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    onError?: (message: string) => void;
} = {}): SearchSink {
    const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    const sleep = deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    const onError = deps.onError ?? (m => console.error(`[search] ${m}`));
    const batchSize = cfg.batchSize ?? 500;
    const flushMs = cfg.flushMs ?? 2000;
    const maxBuffer = cfg.maxBuffer ?? 20_000;
    const timeoutMs = cfg.timeoutMs ?? 30_000;
    const root = cfg.url.replace(/\/+$/, '');
    const auth = cfg.apiKey ? `ApiKey ${cfg.apiKey}`
        : cfg.username ? `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64')}` : undefined;

    let buffer: Item[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sending: Promise<void> = Promise.resolve();

    let closed = false;

    const body = (items: Item[]) => items.map(({ index, doc, id, create }) =>
        `${JSON.stringify({ [create ? 'create' : 'index']: { _index: index, _id: id } })}\n${JSON.stringify(doc)}\n`).join('');

    async function send(items: Item[]): Promise<void> {
        for (let attempt = 1; ; attempt++) {
            let res: Response | null = null;
            try {
                res = await doFetch(`${root}/_bulk`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-ndjson', ...(auth ? { authorization: auth } : {}) },
                    body: body(items),
                    signal: AbortSignal.timeout(timeoutMs),
                });
            } catch (e) {
                if (attempt < TRIES) { await sleep(500 * 2 ** attempt); continue; }
                onError(`bulk of ${items.length} not sent: ${e instanceof Error ? e.message : String(e)}`);
                requeue(items);
                return;
            }
            if (res.status === 429 || res.status >= 500) {
                if (attempt < TRIES) { await sleep(500 * 2 ** attempt); continue; }
                onError(`bulk of ${items.length} not sent: status ${res.status}`);
                requeue(items);
                return;
            }
            if (!res.ok) {
                const why = `bulk of ${items.length} refused: status ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`.trim();
                onError(why);
                drop(items, why);
                return;
            }
            const reply = await res.json().catch(() => null) as { errors?: boolean; items?: Record<string, { status: number; error?: { type?: string; reason?: string } }>[] } | null;
            const again: Item[] = [];
            items.forEach((item, i) => {
                const result = reply?.errors && reply.items?.[i] ? Object.values(reply.items[i])[0] : undefined;
                // A create that finds its id taken: an earlier send of this bulk got there.
                if (!result || result.status < 300 || (item.create && result.status === 409)) { item.confirm?.resolve(); return; }
                if (result.status === 429) { again.push(item); return; }
                const why = `${item.index}: ${result.error?.type ?? result.status} ${result.error?.reason ?? ''}`.trim();
                onError(why);
                item.confirm?.reject(new Error(why));
            });
            if (again.length) requeue(again);
            return;
        }
    }

    /** Back in the buffer, in front; the oldest beyond the cap are dropped. */
    function requeue(items: Item[]) {
        if (closed) {
            onError(`closed: ${items.length} documents not written`);
            drop(items, 'not written: the worker stopped');
            return;
        }
        buffer = [...items, ...buffer];
        trim();
        schedule();
    }

    function trim() {
        if (buffer.length <= maxBuffer) return;
        const dropped = buffer.length - maxBuffer;
        drop(buffer.slice(0, dropped), 'dropped: the buffer was full');
        buffer = buffer.slice(dropped);
        onError(`buffer full: ${dropped} oldest documents dropped`);
    }

    function schedule() {
        if (closed || timer || buffer.length === 0) return;
        timer = setTimeout(() => { timer = null; void flush(); }, flushMs);
        (timer as { unref?: () => void }).unref?.();
    }

    function flush(): Promise<void> {
        if (timer) { clearTimeout(timer); timer = null; }
        // What is buffered now; anything put back while sending waits for the timer.
        const run = sending.then(async () => {
            const pending = buffer;
            buffer = [];
            for (let i = 0; i < pending.length; i += batchSize) {
                try {
                    await send(pending.slice(i, i + batchSize));
                } catch (e) {
                    // Not sent and not to be lost: back in the buffer with the rest.
                    requeue(pending.slice(i));
                    throw e;
                }
            }
        });
        // A failed flush is the caller's to hear about; the next one still runs.
        sending = run.catch(() => {});
        return run;
    }

    function add(item: Item) {
        buffer.push(item);
        trim();
        if (buffer.length >= batchSize) void flush().catch(e => onError(e instanceof Error ? e.message : String(e))); else schedule();
    }

    return {
        write(index, doc, id) {
            add({ index: `${cfg.indexPrefix ?? ''}${index}`, doc, id: id ?? randomUUID(), create: !id });
        },
        writeConfirmed(index, doc, id) {
            return new Promise((resolve, reject) => add({ index: `${cfg.indexPrefix ?? ''}${index}`, doc, id, create: false, confirm: { resolve, reject } }));
        },
        flush,
        async close(deadlineMs = 30_000) {
            const end = Date.now() + deadlineMs;
            let stop: ReturnType<typeof setTimeout> | undefined;
            const deadline = new Promise<void>(r => { stop = setTimeout(r, deadlineMs); });
            // Documents put back by a failed bulk are sent again, until none is left or time is up.
            const drain = (async () => {
                while (Date.now() < end) {
                    await flush().catch(() => {});
                    if (buffer.length === 0) return;
                    await sleep(Math.min(1000, Math.max(0, end - Date.now())));
                }
            })();
            await Promise.race([drain, deadline]);
            clearTimeout(stop);
            closed = true;
            if (timer) { clearTimeout(timer); timer = null; }
            if (buffer.length) {
                onError(`closing: ${buffer.length} documents not written`);
                drop(buffer, 'not written: the worker stopped');
                buffer = [];
            }
        },
    };
}

/** A sink that keeps documents in memory, by index: for tests and dry runs. */
export function memorySink(): SearchSink & { docs: Map<string, { doc: object; id?: string }[]> } {
    const docs = new Map<string, { doc: object; id?: string }[]>();
    const write = (index: string, doc: object, id?: string) => {
        const list = docs.get(index) ?? [];
        const at = id ? list.findIndex(d => d.id === id) : -1;
        if (at >= 0) list[at] = { doc, id }; else list.push({ doc, ...(id ? { id } : {}) });
        docs.set(index, list);
    };
    return {
        docs,
        write,
        writeConfirmed: async (index, doc, id) => write(index, doc, id),
        flush: async () => {},
        close: async () => {},
    };
}
