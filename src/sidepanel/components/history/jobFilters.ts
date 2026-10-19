import type { Job } from '@/shared/types/database';
import type { JobWithRecipe } from '@/shared/db';

export type { JobWithRecipe };

/** Where the job ran: its list page, or the first page of a bulk run. */
export function jobUrl(job: Job): string | undefined {
    return job.input?.urls?.[0];
}

/** What kind of run it was, from its recipe. */
export function jobKind(job: JobWithRecipe): 'list' | 'page' | 'metadata' | undefined {
    return job.recipe?.spec.kind;
}

export function isBulkJob(job: JobWithRecipe): boolean {
    return jobKind(job) === 'page';
}
