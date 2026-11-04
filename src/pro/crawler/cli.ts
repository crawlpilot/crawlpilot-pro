/**
 * The worker from the command line. The configuration is `--config <file>`, or the JSON in the
 * `CRAWLER_CONFIG` environment variable (as a container gets it).
 *   npm run crawler:build
 *   node src/pro/crawler/dist/worker.mjs --config crawler.json
 * takes jobs from the configured SQS queue until stopped. SIGTERM or Ctrl-C (a container stopping): no new jobs
 * or attempts; attempts in progress get `STOP_GRACE_MS`, then are abandoned and their jobs put back; then
 * Elasticsearch is flushed for at most `FLUSH_DEADLINE_MS`. All of it fits in ECS's 120 s `stopTimeout`.
 * A second signal abandons the attempts at once.
 *   … --config crawler.json --jobs jobs.jsonl [--dead-letter dead.jsonl]
 * runs a file of jobs instead, until each is done, failed or dead-lettered, and prints a summary.
 *   … --config crawler.json --setup-elasticsearch
 * puts the index templates (`templates.ts`) and exits.
 *   … --config crawler.json --rollup [YYYY-MM-DD]
 * adds up one day's selector usage (`rollup.ts`; yesterday by default) and exits.
 * While jobs move, the worker touches a heartbeat file (`CRAWLER_HEARTBEAT`, default /tmp/crawler-heartbeat)
 * for a container health check. A browser that fails five times in a row stops the worker with exit code 1,
 * so the task is replaced.
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PageBaselines } from './baseline';
import { BrowserPool } from './browser';
import { loadConfig, parseConfig, siteProfile, sitePolicy } from './config';
import { SiteGovernor } from './governor';
import { ProxyPool } from './proxies';
import { MemoryQueue, runWorker, type JobQueue } from './queue';
import { SqsQueue } from './sqs';
import { RobotsCache } from './robots';
import { createSearchSink } from './search';
import { createRecipeStore } from './store';
import { installTemplates } from './templates';
import { rollupDay, yesterday } from './rollup';
import type { CrawlJob } from './types';
import { siteEventWriter, type JobResult } from './worker';
import { Vitals } from './vitals';

const HEARTBEAT_EVERY_MS = 10_000;
const STOP_GRACE_MS = 60_000;
const FLUSH_DEADLINE_MS = 30_000;
const CLOSE_BROWSER_MS = 10_000;

function arg(name: string, fallback?: string): string {
    const i = process.argv.indexOf(`--${name}`);
    const v = i >= 0 ? process.argv[i + 1] : fallback;
    if (v === undefined) throw new Error(`Missing --${name}`);
    return v;
}

const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
    // A stray rejection is a bug to log, not a reason to drop every job in flight.
    process.on('unhandledRejection', e => console.error('[unhandled]', e instanceof Error ? e.stack ?? e.message : e));
    const config = has('config') ? await loadConfig(arg('config'))
        : process.env.CRAWLER_CONFIG ? parseConfig(JSON.parse(process.env.CRAWLER_CONFIG))
        : (() => { throw new Error('Give --config <file>, or the configuration in CRAWLER_CONFIG.'); })();
    if (has('setup-elasticsearch')) {
        for (const id of await installTemplates(config.search)) console.log(`template ${id}`);
        return;
    }
    if (has('rollup')) {
        const next = process.argv[process.argv.indexOf('--rollup') + 1];
        const date = next && !next.startsWith('--') ? next : yesterday();
        console.log(`${date}: ${await rollupDay(config.search, date)} selector-days written`);
        return;
    }
    const fromFile = has('jobs');
    if (!fromFile && !config.queue) throw new Error('Give --jobs <file>, or a queue in the configuration.');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const script = await readFile(arg('script', path.join(here, 'inpage.js')), 'utf8');

    const sink = createSearchSink(config.search);
    const pages = new BrowserPool({ pagesPerContext: config.pagesPerContext, idleMs: config.contextIdleMs, maxContexts: config.maxContexts, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const governor = new SiteGovernor(host => sitePolicy(config, host), siteEventWriter(sink, config.workerId));
    const proxies = new Map(Object.entries(config.proxyPools).map(([name, list]) => [name, new ProxyPool(list)]));
    // robots.txt goes out as the site's pages do: its profile, through its proxy.
    const robots = new RobotsCache(config.robotsAgent, url => {
        const host = new URL(url).host;
        const profile = siteProfile(config, host);
        const pool = profile.proxyPool ? proxies.get(profile.proxyPool) : undefined;
        return pages.fetchText(url, profile, pool?.pick(host, profile.proxyCountry));
    });
    const store = createRecipeStore({ baseUrl: config.recipeStore.url, token: config.recipeStore.token });
    let jobs: CrawlJob[] = [];
    let queue: JobQueue;
    if (fromFile) {
        jobs = (await readFile(arg('jobs'), 'utf8')).split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as CrawlJob);
        const deadFile = arg('dead-letter', 'dead-letter.jsonl');
        queue = new MemoryQueue(jobs, Date.now, (job, reason) => { void appendFile(deadFile, `${JSON.stringify({ ...job, reason })}\n`); });
    } else {
        queue = new SqsQueue(config.queue!);
        console.log(`Taking jobs from ${config.queue!.url}`);
    }

    let stopping = false;
    const abort = new AbortController();
    const stop = (signal: string) => () => {
        if (stopping) { console.log(`${signal} again: abandoning the attempts in progress.`); abort.abort(); return; }
        stopping = true;
        console.log(`${signal}: finishing the jobs in flight, for ${STOP_GRACE_MS / 1000} s at most…`);
        setTimeout(() => abort.abort(), STOP_GRACE_MS).unref();
    };
    const vitals = new Vitals();
    const heartbeat = process.env.CRAWLER_HEARTBEAT ?? '/tmp/crawler-heartbeat';
    let lastBeat = 0;
    process.on('SIGINT', stop('SIGINT'));
    process.on('SIGTERM', stop('SIGTERM'));
    const counts: Record<JobResult['outcome'], number> = { success: 0, failed: 0, dead_letter: 0, deferred: 0 };
    try {
        await runWorker(queue, { config, store, pages, sink, governor, proxies, robots, script, vitals, baselines: new PageBaselines(), stopped: () => stopping || vitals.unhealthy, signal: abort.signal }, {
            untilIdle: fromFile,
            stopped: () => stopping || vitals.unhealthy,
            onTick: inFlight => {
                if (!vitals.alive(inFlight) || Date.now() - lastBeat < HEARTBEAT_EVERY_MS) return;
                lastBeat = Date.now();
                void writeFile(heartbeat, String(lastBeat)).catch(() => {});
            },
            onResult: (job, r) => {
                counts[r.outcome]++;
                console.log(`${r.outcome.padEnd(11)} ${job.url}${r.reason ? `  (${r.reason})` : ''}`);
            },
        });
    } finally {
        await sink.close(FLUSH_DEADLINE_MS);
        await Promise.race([pages.close(), new Promise(r => setTimeout(r, CLOSE_BROWSER_MS).unref())]);
    }
    if (vitals.unhealthy) {
        console.error('The browser failed five times in a row: stopping, so the task is replaced.');
        process.exitCode = 1;
    }
    console.log(`\n${fromFile ? `${jobs.length} jobs` : 'Stopped'}: ${counts.success} read, ${counts.failed} failed, ${counts.dead_letter} dead-lettered, ${counts.deferred} deferrals.`);
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
