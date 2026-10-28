/**
 * Jobs from Amazon SQS (`JobQueue`, `queue.ts`).
 * - Long polling, up to 10 messages at a time; a received job is hidden for `visibilitySeconds`, so a job a
 *   worker dies on comes back to another worker.
 * - Done (or failed for good): the message is deleted.
 * - Deferred: the job is sent again, with its attempts so far and a `notBefore` time, and the old message is
 *   deleted. SQS delays a message at most 15 minutes; a job that arrives before its `notBefore` is sent
 *   again for the rest of the wait.
 * - Dead letter: the job, with why, goes to `deadLetterUrl`, and the old message is deleted.
 * - A message that is not a job is dead-lettered as it is.
 * - Follow-up jobs (a list's next page, its details pages) are sent ten at a time; if any is refused the
 *   job that led to them is not acknowledged, so it comes back and sends them again (their ids are stable).
 * FIFO queues (`.fifo`) group messages by competitor and deduplicate by job and attempt.
 */
import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageBatchCommand, SendMessageCommand, SQSClient, type Message } from '@aws-sdk/client-sqs';
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
    send(command: ReceiveMessageCommand | SendMessageCommand | SendMessageBatchCommand | DeleteMessageCommand): Promise<unknown>;
}

const MAX_DELAY_S = 900;

function isJob(v: unknown): v is CrawlJob {
    const j = v as CrawlJob;
    return !!j && typeof j.jobId === 'string' && typeof j.url === 'string' && typeof j.competitor === 'string' && typeof j.pageType === 'string';
}

export class SqsQueue implements JobQueue {
    private client: SqsSender;

    constructor(private cfg: SqsConfig, client?: SqsSender, private now: () => number = Date.now,
        private onError: (message: string) => void = m => console.error(`[sqs] ${m}`)) {
        this.client = client ?? new SQSClient({ ...(cfg.region ? { region: cfg.region } : {}), ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}) });
    }

    private fifo(url: string, job: CrawlJob) {
        return url.endsWith('.fifo') ? { MessageGroupId: job.competitor, MessageDeduplicationId: `${job.jobId}-${job.attempts ?? 0}` } : {};
    }

    private async sendTo(url: string, job: CrawlJob, delayMs = 0, extra: object = {}) {
        const fifo = url.endsWith('.fifo');
        await this.client.send(new SendMessageCommand({
            QueueUrl: url,
            MessageBody: JSON.stringify({ ...job, ...extra }),
            // FIFO queues take no per-message delay; the job's notBefore holds it back instead.
            ...(!fifo && delayMs > 0 ? { DelaySeconds: Math.min(MAX_DELAY_S, Math.ceil(delayMs / 1000)) } : {}),
            ...this.fifo(url, job),
        }));
    }

    private async remove(m: Message) {
        await this.client.send(new DeleteMessageCommand({ QueueUrl: this.cfg.url, ReceiptHandle: m.ReceiptHandle! }));
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
                    await this.client.send(new SendMessageCommand({ QueueUrl: this.cfg.deadLetterUrl, MessageBody: JSON.stringify({ body: m.Body, reason: 'not a crawl job' }), ...(this.cfg.deadLetterUrl.endsWith('.fifo') ? { MessageGroupId: 'invalid', MessageDeduplicationId: m.MessageId ?? String(this.now()) } : {}) }));
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
            out.push({
                job: current,
                ack: () => this.remove(m),
                retryLater: async (delayMs, next) => {
                    await this.sendTo(this.cfg.url, next, delayMs, { notBefore: this.now() + delayMs });
                    await this.remove(m);
                },
                deadLetter: async reason => {
                    await this.sendTo(this.cfg.deadLetterUrl, current, 0, { reason, deadAt: new Date(this.now()).toISOString() });
                    await this.remove(m);
                },
            });
        }
        return out;
    }

    async enqueue(jobs: CrawlJob[]): Promise<void> {
        const fifo = this.cfg.url.endsWith('.fifo');
        for (let i = 0; i < jobs.length; i += 10) {
            const batch = jobs.slice(i, i + 10);
            const reply = await this.client.send(new SendMessageBatchCommand({
                QueueUrl: this.cfg.url,
                Entries: batch.map((job, n) => ({ Id: String(n), MessageBody: JSON.stringify(job), ...(fifo ? this.fifo(this.cfg.url, job) : {}) })),
            })) as { Failed?: { Id: string; Message?: string }[] };
            if (reply.Failed?.length) throw new Error(`${reply.Failed.length} follow-up jobs not queued: ${reply.Failed[0].Message ?? 'refused'}`);
        }
    }

    /** A queue service is never done: the worker runs until it is stopped. */
    idle() { return false; }
}
