import type { AutomationRecipe, Job } from '@/shared/types/database';

export type JobWithRecipe = Job & { recipe?: AutomationRecipe };
export type FilterStatus = 'all' | 'running' | 'completed' | 'paused' | 'failed';

const stopped = (j: Job) => j.status === 'paused' || j.status === 'pending' || !!j.stats?.stoppedByUser;
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
        .filter(j => filter === 'all' || (filter === 'paused' ? stopped(j) : filter === 'completed' ? completed(j) : j.status === filter))
        .filter(j => !q || [j.recipe?.name || 'Untitled', j.sourceUrl || '', j.recipe?.type || ''].some(s => s.toLowerCase().includes(q)));
}

export function isBulkJob(job: JobWithRecipe): boolean {
    return job.recipe?.type === 'bulk-extraction' || job.configSnapshot?.type === 'bulk-extraction';
}
