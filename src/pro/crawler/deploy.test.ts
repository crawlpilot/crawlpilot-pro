import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

describe('crawler image', () => {
    it('installs the versions the worker was built and tested with', () => {
        const lock = JSON.parse(read('package-lock.json')).packages as Record<string, { version: string }>;
        const runtime = JSON.parse(read('deploy/crawler/package.json')).dependencies as Record<string, string>;
        for (const [name, version] of Object.entries(runtime)) expect(version, name).toBe(lock[`node_modules/${name}`].version);
    });

    it('runs on the Playwright image of that Playwright version, so its browsers match, as a user', () => {
        const runtime = JSON.parse(read('deploy/crawler/package.json')).dependencies as Record<string, string>;
        const dockerfile = read('deploy/crawler/Dockerfile');
        expect(dockerfile).toContain(`FROM mcr.microsoft.com/playwright:v${runtime.playwright}-`);
        expect(dockerfile).toMatch(/\nUSER pwuser\n/);
    });
});

describe('crawler task', () => {
    it('may make every SQS call the worker makes on its jobs queue', () => {
        const policy = JSON.parse(read('deploy/crawler/iam-task-policy.json')) as { Statement: { Sid: string; Action: string[] }[] };
        const jobs = policy.Statement.find(s => s.Sid === 'TakeJobs')!.Action;
        const calls = [...read('src/pro/crawler/sqs.ts').matchAll(/new (\w+)Command\(/g)].map(m => `sqs:${m[1]}`);
        for (const call of new Set(calls)) expect(jobs, call).toContain(call === 'sqs:SendMessageBatch' ? 'sqs:SendMessage' : call);
    });

    it('stops within its stopTimeout: the worker\'s grace and flush fit in it', () => {
        const task = JSON.parse(read('deploy/crawler/ecs-task-definition.json')) as { containerDefinitions: { stopTimeout: number }[] };
        const cli = read('src/pro/crawler/cli.ts');
        const ms = (name: string) => Number(cli.match(new RegExp(`const ${name} = ([\\d_]+);`))![1].replace(/_/g, ''));
        expect(ms('STOP_GRACE_MS') + ms('FLUSH_DEADLINE_MS') + ms('CLOSE_BROWSER_MS')).toBeLessThan(task.containerDefinitions[0].stopTimeout * 1000);
    });
});
