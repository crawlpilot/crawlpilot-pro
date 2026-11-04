/**
 * Jobs from Amazon SQS (`JobQueue`, `queue.ts`).
 * - Long polling, up to 10 messages at a time; a received job is hidden for `visibilitySeconds`, so a job a
 *   worker dies on comes back to another worker.
 * - Done (or failed for good): the message is deleted.
 * - Deferred: the job is sent again, with its attempts so far and a `notBefore` time, and the old message is
 *   deleted. SQS delays a message at most 15 minutes; a job that arrives before its `notBefore` is sent
 *   again for the rest of the wait.
 * - Dead letter: the job, with why, goes to `deadLetterUrl`, and the old message is deleted.
 * - Sending the job on and deleting its message can't be one step: a delete that fails is tried twice more
 *   (after 0.5 s and 2 s). If it still fails the old message comes back once its visibility ends and the job
 *   runs one more time: its documents and follow-ups are keyed, so that only costs a page visit.
 * - A message that is not a job is dead-lettered as it is.
 * - Follow-up jobs (a list's next page, its details pages) are sent ten at a time; if any is refused the
 *   job that led to them is not acknowledged, so it comes back and sends them again (their ids are stable).
 * - While a job runs its message is kept hidden: its visibility is renewed every half `visibilitySeconds`, so a
 *   long job (a list clicked through, retries on a slow site) is never handed to a second worker. A worker
 *   that dies stops renewing it, and the job comes back.
 * Standard queues only. A FIFO queue holds back a competitor's other jobs while one is in flight or waiting
 * out a cooldown, and deduplicates a job put back within five minutes as a copy: the site governor paces
 * instead, and job ids make a page read twice harmless.
 */
import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SendMessageBatchCommand, SendMessageCommand, SQSClient, type Message } from '@aws-sdk/client-sqs';
import type { Delivery, JobQueue } from './queue';
import type { CrawlJob } from './types';

export interface SqsConfig {
    url: string;
    deadLetterUrl: string;
    region?: string;
    /** Another SQS endpoint: a VPC endpoint, or a local SQS-compatible server. */
    endpoint?: string;
    /** Long-poll wait, 1–20 s. */
    waitSeconds?: number;
    /** How long a received job stays hidden from other workers. */
    visibilitySeconds?: number;
}

/** What the queue needs from the SDK client: `send` (tests pass a fake). */
export interface SqsSender {
    send(command: ReceiveMessageCommand | SendMessageCommand | SendMessageBatchCommand | DeleteMessageCommand | ChangeMessageVisibilityCommand): Promise<unknown>;
}

const MAX_DELAY_S = 900;

const isFifo = (url: string) => url.endsWith('.fifo');

function isJob(v: unknown): v is CrawlJob {
    const j = v as CrawlJob;
    return !!j && typeof j.jobId === 'string' && typeof j.url === 'string' && typeof j.competitor === 'string' && typeof j.pageType === 'string';
}

export class SqsQueue implements JobQueue {
    private client: SqsSender;

    constructor(private cfg: SqsConfig, client?: SqsSender, private now: () => number = Date.now,
        private onError: (message: string) => void = m => console.error(`[sqs] ${m}`),
        private sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))) {
        if (isFifo(cfg.url) || isFifo(cfg.deadLetterUrl)) throw new Error('FIFO queues are not supported: use standard queues (docs/design/crawler.md, Queue).');
        this.client = client ?? new SQSClient({ ...(cfg.region ? { region: cfg.region } : {}), ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}) });
    }

    private async sendTo(url: string, job: CrawlJob, delayMs = 0, extra: object = {}) {
        await this.client.send(new SendMessageCommand({
            QueueUrl: url,
            MessageBody: JSON.stringify({ ...job, ...extra }),
            ...(delayMs > 0 ? { DelaySeconds: Math.min(MAX_DELAY_S, Math.ceil(delayMs / 1000)) } : {}),
        }));
    }

    /** Renews the message's visibility while its job runs; the returned function stops it. */
    private keepHidden(m: Message): () => void {
        const seconds = this.cfg.visibilitySeconds ?? 600;
        const timer = setInterval(() => {
            this.client.send(new ChangeMessageVisibilityCommand({ QueueUrl: this.cfg.url, ReceiptHandle: m.ReceiptHandle!, VisibilityTimeout: seconds }))
                .catch(e => this.onError(`message ${m.MessageId ?? '?'} visibility not renewed: ${e instanceof Error ? e.message : String(e)}`));
        }, seconds * 500);
        (timer as { unref?: () => void }).unref?.();
        return () => clearInterval(timer);
    }

    private async remove(m: Message) {
        for (const wait of [500, 2000, -1]) {
            try {
                await this.client.send(new DeleteMessageCommand({ QueueUrl: this.cfg.url, ReceiptHandle: m.ReceiptHandle! }));
                return;
            } catch (e) {
                if (wait < 0) throw e;
                await this.sleep(wait);
            }
        }
    }

    async receive(max: number): Promise<Delivery[]> {
        const reply = await this.client.send(new ReceiveMessageCommand({
            QueueUrl: this.cfg.url,
            MaxNumberOfMessages: Math.max(1, Math.min(10, max)),
            WaitTimeSeconds: this.cfg.waitSeconds ?? 10,
            VisibilityTimeout: this.cfg.visibilitySeconds ?? 600,
        })) as { Messages?: Message[] };
        const out: Delivery[] = [];
        for (const m of reply.Messages ?? []) {
            let job: unknown;
            try { job = JSON.parse(m.Body ?? ''); } catch { job = undefined; }
            // Each message on its own: one that can't be moved now stays hidden and comes back later,
            // without costing the rest of the batch.
            try {
                if (!isJob(job)) {
                    await this.client.send(new SendMessageCommand({ QueueUrl: this.cfg.deadLetterUrl, MessageBody: JSON.stringify({ body: m.Body, reason: 'not a crawl job' }) }));
                    await this.remove(m);
                    continue;
                }
                const early = (job.notBefore ?? 0) - this.now();
                if (early > 1000) {
                    await this.sendTo(this.cfg.url, job, early);
                    await this.remove(m);
                    continue;
                }
            } catch (e) {
                this.onError(`message ${m.MessageId ?? '?'} left for later: ${e instanceof Error ? e.message : String(e)}`);
                continue;
            }
            const current = job;
            // Settled or given up on, the message is no longer renewed: one not deleted comes back.
            const release = this.keepHidden(m);
            out.push({
                job: current,
                release,
                ack: async () => { release(); await this.remove(m); },
                retryLater: async (delayMs, next) => {
                    release();
                    await this.sendTo(this.cfg.url, next, delayMs, { notBefore: this.now() + delayMs });
                    await this.remove(m);
                },
                deadLetter: async reason => {
                    release();
                    await this.sendTo(this.cfg.deadLetterUrl, current, 0, { reason, deadAt: new Date(this.now()).toISOString() });
                    await this.remove(m);
                },
            });
        }
        return out;
    }

    async enqueue(jobs: CrawlJob[]): Promise<void> {
        for (let i = 0; i < jobs.length; i += 10) {
            const batch = jobs.slice(i, i + 10);
            const reply = await this.client.send(new SendMessageBatchCommand({
                QueueUrl: this.cfg.url,
                Entries: batch.map((job, n) => ({ Id: String(n), MessageBody: JSON.stringify(job) })),
            })) as { Failed?: { Id: string; Message?: string }[] };
            if (reply.Failed?.length) throw new Error(`${reply.Failed.length} follow-up jobs not queued: ${reply.Failed[0].Message ?? 'refused'}`);
        }
    }

    /** A queue service is never done: the worker runs until it is stopped. */
    idle() { return false; }
}
