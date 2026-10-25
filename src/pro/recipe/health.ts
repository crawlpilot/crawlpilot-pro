/**
 * Keeping recipes working (recipe-improvements-plan A14, E22): each field's fill on the pages the version
 * was tested on is its baseline; a crawl that fills it much less says the site changed. A drop of 30
 * points or more needs a repair; 10 or more is worth watching.
 */
import type { CrawlStatus } from '../backend/types';
import type { PageResult } from '../runner/testPage';

export type HealthState = 'healthy' | 'watch' | 'repair';

export const REPAIR_DROP = 0.3;
export const WATCH_DROP = 0.1;

/** Each field's share of the tested pages it was filled on. */
export function baselineOf(results: PageResult[]): Record<string, number> {
    const read = results.filter(r => !r.error);
    const out: Record<string, number> = {};
    for (const r of read) for (const f of r.fields) out[f.name] = (out[f.name] ?? 0) + (f.filled ? 1 : 0);
    for (const name of Object.keys(out)) out[name] = read.length ? out[name] / read.length : 0;
    return out;
}

export interface FieldHealth {
    name: string;
    baseline: number;
    now: number;
    state: HealthState;
    failingPages: string[];
}

export interface CrawlHealth {
    state: HealthState;
    /** Fields that dropped, the worst first. */
    fields: FieldHealth[];
}

/** A finished crawl against the baseline. A crawl still running, or with no baseline, says nothing yet. */
export function crawlHealth(baseline: Record<string, number> | undefined, crawl: CrawlStatus | undefined): CrawlHealth | null {
    if (!baseline || !crawl || crawl.status !== 'done') return null;
    const fields = crawl.fields.flatMap(f => {
        const base = baseline[f.name];
        if (base === undefined) return [];
        const drop = base - f.fill;
        const state: HealthState = drop >= REPAIR_DROP ? 'repair' : drop >= WATCH_DROP ? 'watch' : 'healthy';
        return state === 'healthy' ? [] : [{ name: f.name, baseline: base, now: f.fill, state, failingPages: f.failingPages ?? [] }];
    }).sort((a, b) => (b.baseline - b.now) - (a.baseline - a.now));
    const state: HealthState = fields.some(f => f.state === 'repair') ? 'repair' : fields.length ? 'watch' : 'healthy';
    return { state, fields };
}
