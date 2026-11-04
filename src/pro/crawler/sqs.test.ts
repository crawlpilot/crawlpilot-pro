import { describe, expect, it, vi } from 'vitest';
import { SqsQueue, type SqsSender } from './sqs';

const URL = 'https://sqs.eu-west-1.amazonaws.com/123/crawl-jobs';
const DLQ = 'https://sqs.eu-west-1.amazonaws.com/123/crawl-dead';
const job = { jobId: 'j1', url: 'https://acme.test/p/1', competitor: 'acme', pageType: 'product' };

function fakeSqs(messages: { Body: string; ReceiptHandle: string; MessageId?: string }[]) {
    const sent: { command: string; input: any }[] = [];
    const client: SqsSender = {
        async send(command) {
            sent.push({ command: command.constructor.name, input: command.input });
            if (command.constructor.name === 'ReceiveMessageCommand') return { Messages: messages.splice(0) };
            return {};
        },
    };
    return { client, sent };
}

describe('SQS queue', () => {
    it('long-polls, at most 10 at a time, and deletes a job once done', async () => {
        const sqs = fakeSqs([{ Body: JSON.stringify(job), ReceiptHandle: 'r1' }]);
        const q = new SqsQueue({ url: URL, deadLetterUrl: DLQ, waitSeconds: 20, visibilitySeconds: 300 }, sqs.client);
        const [d] = await q.receive(25);
        expect(sqs.sent[0]).toEqual({ command: 'ReceiveMessageCommand', input: { QueueUrl: URL, MaxNumberOfMessages: 10, WaitTimeSeconds: 20, VisibilityTimeout: 300 } });
        expect(d.job).toEqual(job);
        await d.ack();
        expect(sqs.sent[1]).toEqual({ command: 'DeleteMessageCommand', input: { QueueUrl: URL, ReceiptHandle: 'r1' } });
        expect(q.idle()).toBe(false);
    });

    it('puts a deferred job back with its attempts, delayed at most 15 minutes, and a notBefore for the rest', async () => {
        let t = 1_000_000;
        const sqs = fakeSqs([{ Body: JSON.stringify(job), ReceiptHandle: 'r1' }]);
        const q = new SqsQueue({ url: URL, deadLetterUrl: DLQ }, sqs.client, () => t);
        const [d] = await q.receive(1);
        await d.retryLater(3_600_000, { ...job, attempts: 2 });
        expect(sqs.sent[1].input).toEqual({ QueueUrl: URL, MessageBody: JSON.stringify({ ...job, attempts: 2, notBefore: t + 3_600_000 }), DelaySeconds: 900 });
        expect(sqs.sent[2].command).toBe('DeleteMessageCommand');

        // It comes back after 15 minutes, early: sent again for the rest of the wait, not run.
        t += 900_000;
        const early = fakeSqs([{ Body: sqs.sent[1].input.MessageBody, ReceiptHandle: 'r2' }]);
        const q2 = new SqsQueue({ url: URL, deadLetterUrl: DLQ }, early.client, () => t);
        expect(await q2.receive(1)).toEqual([]);
        expect(early.sent[1].input.DelaySeconds).toBe(900);
        expect(early.sent[2]).toEqual({ command: 'DeleteMessageCommand', input: { QueueUrl: URL, ReceiptHandle: 'r2' } });
    });

    it('dead-letters with the reason, and a message that is not a job as it is', async () => {
        const sqs = fakeSqs([{ Body: JSON.stringify(job), ReceiptHandle: 'r1' }, { Body: 'garbage', ReceiptHandle: 'r2', MessageId: 'm2' }]);
        const q = new SqsQueue({ url: URL, deadLetterUrl: DLQ }, sqs.client, () => Date.parse('2026-10-28T12:00:00Z'));
        const [d] = await q.receive(10);
        expect(sqs.sent[1]).toEqual({ command: 'SendMessageCommand', input: { QueueUrl: DLQ, MessageBody: JSON.stringify({ body: 'garbage', reason: 'not a crawl job' }) } });
        expect(sqs.sent[2].input.ReceiptHandle).toBe('r2');
        await d.deadLetter('no_recipe');
        expect(JSON.parse(sqs.sent[3].input.MessageBody)).toEqual({ ...job, reason: 'no_recipe', deadAt: '2026-10-28T12:00:00.000Z' });
        expect(sqs.sent[4].input.ReceiptHandle).toBe('r1');
    });

    it('refuses FIFO queues', () => {
        expect(() => new SqsQueue({ url: `${URL}.fifo`, deadLetterUrl: DLQ }, fakeSqs([]).client)).toThrow('FIFO queues are not supported');
        expect(() => new SqsQueue({ url: URL, deadLetterUrl: `${DLQ}.fifo` }, fakeSqs([]).client)).toThrow('FIFO queues are not supported');
    });

    it('keeps a running job hidden, every half visibility, until it is settled or released', async () => {
        vi.useFakeTimers();
        try {
            const sqs = fakeSqs([{ Body: JSON.stringify(job), ReceiptHandle: 'r1' }, { Body: JSON.stringify({ ...job, jobId: 'j2' }), ReceiptHandle: 'r2' }]);
            const q = new SqsQueue({ url: URL, deadLetterUrl: DLQ, visibilitySeconds: 60 }, sqs.client);
            const [a, b] = await q.receive(2);
            const renewals = () => sqs.sent.filter(x => x.command === 'ChangeMessageVisibilityCommand').map(x => x.input.ReceiptHandle);
            await vi.advanceTimersByTimeAsync(30_000);
            expect(renewals()).toEqual(['r1', 'r2']);
            expect(sqs.sent.find(x => x.command === 'ChangeMessageVisibilityCommand')!.input).toEqual({ QueueUrl: URL, ReceiptHandle: 'r1', VisibilityTimeout: 60 });
            await a.ack();
            b.release!();
            await vi.advanceTimersByTimeAsync(120_000);
            expect(renewals()).toEqual(['r1', 'r2']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('sends follow-up jobs ten at a time, and fails when one is refused', async () => {
        const sqs = fakeSqs([]);
        const q = new SqsQueue({ url: URL, deadLetterUrl: DLQ }, sqs.client);
        const jobs = Array.from({ length: 12 }, (_, i) => ({ ...job, jobId: `j~d${i}` }));
        await q.enqueue(jobs);
        expect(sqs.sent.map(s => [s.command, s.input.Entries.length])).toEqual([['SendMessageBatchCommand', 10], ['SendMessageBatchCommand', 2]]);
        expect(JSON.parse(sqs.sent[1].input.Entries[1].MessageBody).jobId).toBe('j~d11');

        const refusing: SqsSender = { send: async () => ({ Failed: [{ Id: '0', Message: 'too big' }] }) };
        await expect(new SqsQueue({ url: URL, deadLetterUrl: DLQ }, refusing).enqueue([job])).rejects.toThrow('1 follow-up jobs not queued: too big');
    });

    it('tries a failed delete again, so a job sent on is not left behind as a second copy', async () => {
        const waits: number[] = [];
        const sqs = fakeSqs([{ Body: JSON.stringify(job), ReceiptHandle: 'r1' }]);
        let failures = 2;
        const flaky: SqsSender = { send: async c => { if (c.constructor.name === 'DeleteMessageCommand' && failures-- > 0) throw new Error('throttled'); return sqs.client.send(c); } };
        const q = new SqsQueue({ url: URL, deadLetterUrl: DLQ }, flaky, () => 0, () => {}, async ms => { waits.push(ms); });
        const [d] = await q.receive(1);
        await d.retryLater(1000, { ...job, attempts: 1 });
        expect(waits).toEqual([500, 2000]);
        expect(sqs.sent.map(x => x.command)).toEqual(['ReceiveMessageCommand', 'SendMessageCommand', 'DeleteMessageCommand']);

        // Three failures: the settle fails, and the run loop logs it.
        const down = fakeSqs([{ Body: JSON.stringify(job), ReceiptHandle: 'r2' }]);
        const refusing: SqsSender = { send: async c => { if (c.constructor.name === 'DeleteMessageCommand') throw new Error('throttled'); return down.client.send(c); } };
        const [d3] = await new SqsQueue({ url: URL, deadLetterUrl: DLQ }, refusing, () => 0, () => {}, async () => {}).receive(1);
        await expect(d3.ack()).rejects.toThrow('throttled');
    });
});
