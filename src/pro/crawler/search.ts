/**
 * Writes documents to Elasticsearch (or OpenSearch: the `_bulk` API is the same) in batches.
 * - A document with an id is indexed (a redelivered job overwrites its scrape); one without is created
 *   (request events only ever add).
 * - A batch is sent when it is full or `flushMs` after the first document, whichever comes first.
 * - Elasticsearch down or 429: the batch is tried again with a backoff; items it rejects with 429 go back
 *   in the buffer; other item errors (a mapping conflict) are reported and dropped.
 * - The buffer is capped: when Elasticsearch stays away, the oldest documents are dropped and reported.
 *   Crawling never waits on telemetry.
 */

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
}

export interface SearchSink {
    /** Queues a document; `id` makes it replace the one with the same id. */
    write(index: string, doc: object, id?: string): void;
    flush(): Promise<void>;
    close(): Promise<void>;
}

interface Item { index: string; doc: object; id?: string }

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
    const root = cfg.url.replace(/\/+$/, '');
    const auth = cfg.apiKey ? `ApiKey ${cfg.apiKey}`
        : cfg.username ? `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64')}` : undefined;

    let buffer: Item[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sending: Promise<void> = Promise.resolve();

    const body = (items: Item[]) => items.map(({ index, doc, id }) =>
        `${JSON.stringify(id ? { index: { _index: index, _id: id } } : { create: { _index: index } })}\n${JSON.stringify(doc)}\n`).join('');

    async function send(items: Item[]): Promise<void> {
        for (let attempt = 1; ; attempt++) {
            let res: Response | null = null;
            try {
                res = await doFetch(`${root}/_bulk`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-ndjson', ...(auth ? { authorization: auth } : {}) },
                    body: body(items),
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
                onError(`bulk of ${items.length} refused: status ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
                return;
            }
            const reply = await res.json().catch(() => null) as { errors?: boolean; items?: Record<string, { status: number; error?: { type?: string; reason?: string } }>[] } | null;
            if (reply?.errors && reply.items) {
                const again: Item[] = [];
                reply.items.forEach((r, i) => {
                    const result = Object.values(r)[0];
                    if (!result || result.status < 300) return;
                    if (result.status === 429) again.push(items[i]);
                    else onError(`${items[i].index}: ${result.error?.type ?? result.status} ${result.error?.reason ?? ''}`.trim());
                });
                if (again.length) requeue(again);
            }
            return;
        }
    }

    /** Back in the buffer, in front; the oldest beyond the cap are dropped. */
    function requeue(items: Item[]) {
        buffer = [...items, ...buffer];
        trim();
        schedule();
    }

    function trim() {
        if (buffer.length <= maxBuffer) return;
        const dropped = buffer.length - maxBuffer;
        buffer = buffer.slice(dropped);
        onError(`buffer full: ${dropped} oldest documents dropped`);
    }

    function schedule() {
        if (timer || buffer.length === 0) return;
        timer = setTimeout(() => { timer = null; void flush(); }, flushMs);
        (timer as { unref?: () => void }).unref?.();
    }

    function flush(): Promise<void> {
        if (timer) { clearTimeout(timer); timer = null; }
        // What is buffered now; anything put back while sending waits for the timer.
        sending = sending.then(async () => {
            const pending = buffer;
            buffer = [];
            for (let i = 0; i < pending.length; i += batchSize) await send(pending.slice(i, i + batchSize));
        });
        return sending;
    }

    return {
        write(index, doc, id) {
            buffer.push({ index: `${cfg.indexPrefix ?? ''}${index}`, doc, ...(id ? { id } : {}) });
            trim();
            if (buffer.length >= batchSize) void flush(); else schedule();
        },
        flush,
        async close() {
            await flush();
            if (timer) { clearTimeout(timer); timer = null; }
        },
    };
}

/** A sink that keeps documents in memory, by index: for tests and dry runs. */
export function memorySink(): SearchSink & { docs: Map<string, { doc: object; id?: string }[]> } {
    const docs = new Map<string, { doc: object; id?: string }[]>();
    return {
        docs,
        write(index, doc, id) {
            const list = docs.get(index) ?? [];
            const at = id ? list.findIndex(d => d.id === id) : -1;
            if (at >= 0) list[at] = { doc, id }; else list.push({ doc, ...(id ? { id } : {}) });
            docs.set(index, list);
        },
        flush: async () => {},
        close: async () => {},
    };
}
