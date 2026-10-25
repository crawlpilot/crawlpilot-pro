/**
 * "My data" (docs/plans/ux-simplification-plan.md §4.5): one entry per thing the user has, not one
 * per job and another per dataset. A saved table with the run that wrote it (its status, so it can
 * run again), and the runs that have no table yet (still running, or failed before saving).
 */
import type { Job, Table } from '@/shared/types/database';
import type { JobWithRecipe } from '@/shared/db';
import { jobUrl } from './jobFilters';

export type DataStatus = 'ready' | 'running' | 'stopped' | 'failed';

export interface DataEntry {
    key: string;
    name: string;
    /** The site it came from: a host name, or '' when unknown. */
    site: string;
    rows: number;
    /** Last change, epoch ms. */
    when: number;
    status: DataStatus;
    table?: Table;
    job?: JobWithRecipe;
}

function hostOf(url?: string): string {
    if (!url) return '';
    try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

function statusOf(job?: Job): DataStatus {
    if (!job) return 'ready';
    if (job.status === 'running') return 'running';
    if (job.status === 'failed') return 'failed';
    if (job.status === 'stopped' || job.stats?.stoppedByUser) return 'stopped';
    return 'ready';
}

/** The user's data, newest first. Previews (an unfinished pick) and empty tables without a run are left out. */
export function dataEntries(tables: Table[], jobs: JobWithRecipe[]): DataEntry[] {
    const latestRun = new Map<number, JobWithRecipe>();
    for (const job of jobs) {
        if (job.tableId === undefined) continue;
        const seen = latestRun.get(job.tableId);
        if (!seen || job.createdAt > seen.createdAt) latestRun.set(job.tableId, job);
    }

    const out: DataEntry[] = [];
    const shown = new Set<number>();
    for (const table of tables) {
        if (table.preview || table.id === undefined) continue;
        const job = latestRun.get(table.id) ?? jobs.find(j => j.id === table.jobId);
        if (table.rowCount === 0 && !job) continue;
        if (job?.id !== undefined) shown.add(job.id);
        out.push({
            key: `t${table.id}`, name: table.name, site: hostOf(table.sourceUrl), rows: table.rowCount,
            when: Math.max(table.updatedAt || 0, table.createdAt || 0, job?.createdAt || 0), status: statusOf(job), table, job,
        });
    }
    for (const job of jobs) {
        if (job.id === undefined || shown.has(job.id)) continue;
        // Its table exists but wasn't listed (older than the page of tables read): it shows with its table.
        if (job.tableId !== undefined && tables.some(t => t.id === job.tableId)) continue;
        out.push({
            key: `j${job.id}`, name: job.name || job.recipe?.name || '', site: hostOf(jobUrl(job)), rows: job.stats?.itemsExtracted ?? 0,
            when: job.createdAt, status: statusOf(job), job,
        });
    }
    return out.sort((a, b) => b.when - a.when);
}

/** Entries whose name or site contains the query. */
export function searchEntries(entries: DataEntry[], query: string): DataEntry[] {
    const q = query.trim().toLowerCase();
    return q ? entries.filter(e => `${e.name} ${e.site}`.toLowerCase().includes(q)) : entries;
}
