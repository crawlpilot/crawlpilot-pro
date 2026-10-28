/**
 * Where jobs come from and what happens to them after (`processJob`): acked when done, put back with a
 * delay (and the attempts so far) when deferred, dead-lettered for a person when they can't be done.
 * `MemoryQueue` serves tests and runs from a JSONL file; a queue service (SQS) implements the same interface.
 */
import type { CrawlJob } from './types';
import { processJob, type JobResult, type WorkerDeps } from './worker';

export interface Delivery {
    job: CrawlJob;
    ack(): Promise<void>;
    retryLater(delayMs: number, job: CrawlJob): Promise<void>;
    deadLetter(reason: string): Promise<void>;
    /** Done with the delivery, settled or not (a queue that keeps a running job hidden stops here). */
    release?(): void;
}

export interface JobQueue {
    /** Up to `max` jobs ready now; none when none is. */
    receive(max: number): Promise<Delivery[]>;
    /** New jobs a job led to (a list's next page, its rows' details pages). */
    enqueue(jobs: CrawlJob[]): Promise<void>;
    /** Nothing waiting and nothing delayed: a finite queue is done. */
    idle(): boolean;
}

export class MemoryQueue implements JobQueue {
    private ready: CrawlJob[];
    private delayed: { at: number; job: CrawlJob }[] = [];
    readonly done: { job: CrawlJob; outcome: 'success' | 'failed' }[] = [];
    readonly dead: { job: CrawlJob; reason: string }[] = [];

    constructor(jobs: CrawlJob[], private now: () => number = Date.now, private onDead?: (job: CrawlJob, reason: string) => void) {
        this.ready = [...jobs];
    }

    async receive(max: number): Promise<Delivery[]> {
        const t = this.now();
        const due = this.delayed.filter(d => d.at <= t).sort((a, b) => a.at - b.at);
        this.delayed = this.delayed.filter(d => d.at > t);
        this.ready.push(...due.map(d => d.job));
        return this.ready.splice(0, max).map(job => ({
            job,
            ack: async () => { this.done.push({ job, outcome: 'success' }); },
            retryLater: async (delayMs, next) => { this.delayed.push({ at: this.now() + delayMs, job: next }); },
            deadLetter: async reason => { this.dead.push({ job, reason }); this.onDead?.(job, reason); },
        }));
    }

    async enqueue(jobs: CrawlJob[]) { this.ready.push(...jobs); }

    idle() { return this.ready.length === 0 && this.delayed.length === 0; }

    /** How long until the next delayed job is due. */
    nextDueIn(): number {
        return this.delayed.length ? Math.max(0, Math.min(...this.delayed.map(d => d.at)) - this.now()) : Infinity;
    }
}

export interface RunOptions {
    /** Return when the queue is idle and nothing is in flight (a file of jobs); else run until stopped. */
    untilIdle?: boolean;
    stopped?: () => boolean;
    onResult?: (job: CrawlJob, result: JobResult) => void;
    /** A queue call failed; the worker carries on (default: logged). */
    onError?: (message: string) => void;
    /** Each turn of the loop, with the jobs in flight (the command line keeps its heartbeat here). */
    onTick?: (inFlight: number) => void;
    /** Runs one job (tests replace it). */
    process?: typeof processJob;
}

/** Longest wait between tries when the queue keeps failing to answer. */
const MAX_RECEIVE_BACKOFF_MS = 30_000;
/** How long a job waits for Elasticsearch to confirm its documents; then it is put back, to be read again. */
export const WRITE_WAIT_MS = 120_000;
const WRITE_RETRY_MS = 60_000;
/** Documents refused this many times in a row (a mapping conflict, not an outage) send the job to a person. */
export const MAX_WRITE_FAILURES = 5;

/** Every document confirmed; or why not (dropped, not in time, the worker stopping). */
async function confirmed(writes: Promise<void>[], signal?: AbortSignal): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const late = new Promise<string>(r => {
        timer = setTimeout(() => r(`not confirmed within ${WRITE_WAIT_MS} ms`), WRITE_WAIT_MS);
        onAbort = () => r('worker stopping');
        if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return await Promise.race([Promise.all(writes).then(() => null, (e: unknown) => e instanceof Error ? e.message : String(e)), late]);
    } finally {
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
}

/**
 * Keeps `config.concurrency` jobs in flight, and settles each delivery by its result. Nothing a job or the
 * queue does can stop the loop: a job that throws is dead-lettered, a settle that fails is logged and its
 * message left for the queue to deliver again, and a receive that fails is tried again with a backoff.
 * A job is acknowledged only once its documents are confirmed; if they aren't, it is put back to be read again
 * (its documents are keyed, so nothing is doubled). A job put back for the first time is stamped `firstSeenAt`.
 */
export async function runWorker(queue: JobQueue, deps: WorkerDeps, o: RunOptions = {}): Promise<void> {
    const sleep = deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    const onError = o.onError ?? (m => console.error(`[queue] ${m}`));
    const run = o.process ?? processJob;
    const now = deps.now ?? Date.now;
    const inFlight = new Set<Promise<void>>();
    const settle = async (d: Delivery) => {
        const takenAt = now();
        let result: JobResult;
        try {
            result = await run(d.job, deps);
        } catch (e) {
            // A bug, not a page: keep the job for a person rather than lose it.
            result = { outcome: 'dead_letter', attempts: d.job.attempts ?? 0, reason: `worker error: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (result.outcome !== 'deferred' && result.writes?.length) {
            const missing = await confirmed(result.writes, deps.signal);
            if (missing === 'worker stopping') {
                result = { outcome: 'deferred', attempts: d.job.attempts ?? 0, delayMs: 0, reason: 'documents not written: worker stopping', ...(result.patch ? { patch: result.patch } : {}) };
            } else if (missing) {
                const writeFailures = (d.job.writeFailures ?? 0) + 1;
                const last = writeFailures >= MAX_WRITE_FAILURES;
                onError(`job ${d.job.jobId}: documents not written (${missing}); ${last ? 'dead-lettered' : 'put back to be read again'}`);
                result = last
                    ? { outcome: 'dead_letter', attempts: d.job.attempts ?? 0, reason: `documents not written ${writeFailures} times: ${missing}` }
                    : { outcome: 'deferred', attempts: d.job.attempts ?? 0, delayMs: WRITE_RETRY_MS, reason: `documents not written: ${missing}`, patch: { ...result.patch, writeFailures } };
            } else if (d.job.writeFailures) {
                result = { ...result, patch: { ...result.patch, writeFailures: 0 } };
            }
        }
        deps.vitals?.progressed();
        try { o.onResult?.(d.job, result); } catch { /* reporting never settles a job */ }
        try {
            // Follow-ups first: a job is only settled once what it led to is safely queued.
            if (result.outcome !== 'deferred' && result.followUps?.length) await queue.enqueue(result.followUps);
            if (result.outcome === 'deferred') await d.retryLater(result.delayMs, { ...d.job, firstSeenAt: d.job.firstSeenAt ?? takenAt, ...result.patch, attempts: result.attempts });
            else if (result.outcome === 'dead_letter') await d.deadLetter(result.reason ?? 'dead letter');
            else await d.ack();
        } catch (e) {
            // Left as it is, the message comes back when its visibility ends; its documents are keyed, so
            // reading it again overwrites them.
            onError(`job ${d.job.jobId} not settled (${result.outcome}): ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            d.release?.();
        }
    };
    let receiveFailures = 0;
    while (!o.stopped?.()) {
        o.onTick?.(inFlight.size);
        const free = deps.config.concurrency - inFlight.size;
        let deliveries: Delivery[] = [];
        if (free > 0) {
            try {
                deliveries = await queue.receive(free);
                receiveFailures = 0;
            } catch (e) {
                receiveFailures++;
                const backoff = Math.min(MAX_RECEIVE_BACKOFF_MS, 1000 * 2 ** (receiveFailures - 1));
                onError(`receive failed (${receiveFailures} in a row), again in ${backoff} ms: ${e instanceof Error ? e.message : String(e)}`);
                await (inFlight.size ? Promise.race([...inFlight, sleep(backoff)]) : sleep(backoff));
                continue;
            }
        }
        for (const d of deliveries) {
            const task = settle(d).finally(() => inFlight.delete(task));
            inFlight.add(task);
        }
        if (deliveries.length) continue;
        if (inFlight.size === 0 && o.untilIdle && queue.idle()) break;
        const wait = queue instanceof MemoryQueue ? Math.min(1000, queue.nextDueIn()) : 1000;
        await (inFlight.size ? Promise.race([...inFlight, sleep(wait)]) : sleep(wait));
    }
    await Promise.all(inFlight);
}
