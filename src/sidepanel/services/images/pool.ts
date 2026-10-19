/**
 * Runs `work` over `items`, at most `concurrency` at a time and at most `perKey` at a time for one key
 * (a host: hammering one CDN gets a 429 or a block). Items start in order as slots free up. A
 * rejected `work` is the caller's to report: the pool keeps going. Stops starting new items once
 * `signal` aborts.
 */
export async function runPool<T>(
    items: T[],
    keyOf: (item: T) => string,
    work: (item: T, index: number) => Promise<void>,
    { concurrency = 6, perKey = 2, signal }: { concurrency?: number; perKey?: number; signal?: AbortSignal } = {},
): Promise<void> {
    const waiting = items.map((item, index) => ({ item, index, key: keyOf(item) }));
    const active = new Map<string, number>();
    let running = 0;

    await new Promise<void>(resolve => {
        const pump = () => {
            if (signal?.aborted) waiting.length = 0;
            for (let i = 0; i < waiting.length && running < concurrency;) {
                const next = waiting[i];
                if ((active.get(next.key) ?? 0) >= perKey) { i++; continue; }
                waiting.splice(i, 1);
                running++;
                active.set(next.key, (active.get(next.key) ?? 0) + 1);
                work(next.item, next.index).catch(() => undefined).finally(() => {
                    running--;
                    active.set(next.key, active.get(next.key)! - 1);
                    pump();
                });
            }
            if (running === 0 && waiting.length === 0) resolve();
        };
        pump();
    });
}

/** The pool key for a URL: its host (inline images share one key). */
export function hostKey(url: string): string {
    try { return new URL(url).host || 'inline'; } catch { return 'inline'; }
}
