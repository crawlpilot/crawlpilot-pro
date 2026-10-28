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
}

export interface JobQueue {
    /** Up to `max` jobs ready now; none when none is. */
    receive(max: number): Promise<Delivery[]>;
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
}

/** Keeps `config.concurrency` jobs in flight, and settles each delivery by its result. */
export async function runWorker(queue: JobQueue, deps: WorkerDeps, o: RunOptions = {}): Promise<void> {
    const sleep = deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    const inFlight = new Set<Promise<void>>();
    const settle = async (d: Delivery) => {
        let result: JobResult;
        try {
            result = await processJob(d.job, deps);
        } catch (e) {
            // A bug, not a page: keep the job for a person rather than lose it.
            result = { outcome: 'dead_letter', attempts: d.job.attempts ?? 0, reason: `worker error: ${e instanceof Error ? e.message : String(e)}` };
        }
        o.onResult?.(d.job, result);
        if (result.outcome === 'deferred') await d.retryLater(result.delayMs, { ...d.job, attempts: result.attempts });
        else if (result.outcome === 'dead_letter') await d.deadLetter(result.reason ?? 'dead letter');
        else await d.ack();
    };
    while (!o.stopped?.()) {
        const free = deps.config.concurrency - inFlight.size;
        const deliveries = free > 0 ? await queue.receive(free) : [];
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
