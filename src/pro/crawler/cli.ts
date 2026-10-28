/**
 * The worker from the command line, on a JSONL file of jobs:
 *   npm run crawler:build
 *   node src/pro/crawler/dist/worker.mjs --config crawler.json --jobs jobs.jsonl [--dead-letter dead.jsonl]
 * Runs until every job is done, failed or dead-lettered (deferred jobs wait their turn), then flushes
 * Elasticsearch and prints a summary. Ctrl-C stops taking jobs and finishes the ones in flight.
 *   node src/pro/crawler/dist/worker.mjs --config crawler.json --setup-elasticsearch
 * puts the index templates (`templates.ts`) and exits.
 */
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserPool } from './browser';
import { loadConfig, siteProfile, sitePolicy } from './config';
import { SiteGovernor } from './governor';
import { ProxyPool } from './proxies';
import { MemoryQueue, runWorker } from './queue';
import { RobotsCache } from './robots';
import { createSearchSink } from './search';
import { createRecipeStore } from './store';
import { installTemplates } from './templates';
import type { CrawlJob } from './types';
import { siteEventWriter, type JobResult } from './worker';

function arg(name: string, fallback?: string): string {
    const i = process.argv.indexOf(`--${name}`);
    const v = i >= 0 ? process.argv[i + 1] : fallback;
    if (v === undefined) throw new Error(`Missing --${name}`);
    return v;
}

async function main() {
    const config = await loadConfig(arg('config'));
    if (process.argv.includes('--setup-elasticsearch')) {
        for (const id of await installTemplates(config.search)) console.log(`template ${id}`);
        return;
    }
    const jobs = (await readFile(arg('jobs'), 'utf8')).split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as CrawlJob);
    const deadFile = arg('dead-letter', 'dead-letter.jsonl');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const script = await readFile(arg('script', path.join(here, 'inpage.js')), 'utf8');

    const sink = createSearchSink(config.search);
    const pages = new BrowserPool({ pagesPerContext: config.pagesPerContext, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
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
    const queue = new MemoryQueue(jobs, Date.now, (job, reason) => { void appendFile(deadFile, `${JSON.stringify({ ...job, reason })}\n`); });

    let stopping = false;
    process.on('SIGINT', () => { stopping = true; console.log('Stopping: finishing the jobs in flight…'); });
    const counts: Record<JobResult['outcome'], number> = { success: 0, failed: 0, dead_letter: 0, deferred: 0 };
    try {
        await runWorker(queue, { config, store, pages, sink, governor, proxies, robots, script }, {
            untilIdle: true,
            stopped: () => stopping,
            onResult: (job, r) => {
                counts[r.outcome]++;
                console.log(`${r.outcome.padEnd(11)} ${job.url}${r.reason ? `  (${r.reason})` : ''}`);
            },
        });
    } finally {
        await sink.close();
        await pages.close();
    }
    console.log(`\n${jobs.length} jobs: ${counts.success} read, ${counts.failed} failed, ${counts.dead_letter} dead-lettered, ${counts.deferred} deferrals.`);
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
