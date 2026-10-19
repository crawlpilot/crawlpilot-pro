import type { Job } from '@/shared/types/database';
import type { JobWithRecipe } from '@/shared/db';

export type { JobWithRecipe };
export type FilterStatus = 'all' | 'running' | 'completed' | 'stopped' | 'failed';

const stopped = (j: Job) => j.status === 'stopped' || !!j.stats?.stoppedByUser;

/** Where the job ran: its list page, or the first page of a bulk run. */
export function jobUrl(job: Job): string | undefined {
    return job.input?.urls?.[0];
}

/** What kind of run it was, from its recipe. */
export function jobKind(job: JobWithRecipe): 'list' | 'page' | 'metadata' | undefined {
    return job.recipe?.spec.kind;
}
const completed = (j: Job) => j.status === 'completed' && !j.stats?.stoppedByUser;

export function jobCounts(jobs: Job[]) {
    return {
        all: jobs.length,
        running: jobs.filter(j => j.status === 'running').length,
        completed: jobs.filter(completed).length,
        stopped: jobs.filter(stopped).length,
        failed: jobs.filter(j => j.status === 'failed').length,
    };
}

/** Jobs with the status filter, whose name, URL or type contains the search query. */
export function filterJobs(jobs: JobWithRecipe[], filter: FilterStatus, query: string): JobWithRecipe[] {
    const q = query.toLowerCase();
    return jobs
        .filter(j => filter === 'all' || (filter === 'stopped' ? stopped(j) : filter === 'completed' ? completed(j) : j.status === filter))
        .filter(j => !q || [j.recipe?.name || 'Untitled', jobUrl(j) || '', jobKind(j) || ''].some(s => s.toLowerCase().includes(q)));
}

export function isBulkJob(job: JobWithRecipe): boolean {
    return jobKind(job) === 'page';
}
