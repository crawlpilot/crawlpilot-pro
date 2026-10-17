/** Runs (`jobs`) and the recipes they ran (`recipes`). */
import type { AutomationRecipe, Job } from '../types/database';
import { done, req, transaction, walk } from './idb';
import { STORES } from './schema';
import { tables } from './tables';

export type JobWithRecipe = Job & { recipe?: AutomationRecipe };

async function createRecipe(recipe: AutomationRecipe): Promise<number> {
    const tx = await transaction(STORES.recipes, 'readwrite');
    return await req(tx.objectStore(STORES.recipes).add(recipe)) as number;
}

async function getRecipe(id: number): Promise<AutomationRecipe | null> {
    const tx = await transaction(STORES.recipes);
    return (await req(tx.objectStore(STORES.recipes).get(id))) ?? null;
}

async function create(job: Job): Promise<number> {
    const tx = await transaction(STORES.jobs, 'readwrite');
    return await req(tx.objectStore(STORES.jobs).add(job)) as number;
}

async function update(id: number, patch: Partial<Job>): Promise<void> {
    const tx = await transaction(STORES.jobs, 'readwrite');
    const store = tx.objectStore(STORES.jobs);
    const current: Job | undefined = await req(store.get(id));
    if (!current) throw new Error(`Job ${id} not found`);
    store.put({ ...current, ...patch, updatedAt: Date.now() });
    await done(tx);
}

/** Newest first, each with its recipe. */
async function list(limit = 100): Promise<JobWithRecipe[]> {
    const tx = await transaction([STORES.jobs, STORES.recipes]);
    const jobs: Job[] = [];
    await walk<Job>(tx.objectStore(STORES.jobs).index('createdAt').openCursor(null, 'prev'), j => {
        jobs.push(j);
        return jobs.length < limit;
    });
    const recipes = tx.objectStore(STORES.recipes);
    const byId = new Map<number, AutomationRecipe>();
    for (const id of new Set(jobs.map(j => j.recipeId))) {
        const recipe: AutomationRecipe | undefined = await req(recipes.get(id));
        if (recipe) byId.set(id, recipe);
    }
    return jobs.map(j => ({ ...j, recipe: byId.get(j.recipeId) }));
}

/** Deletes a job and its table; its recipe too, unless another job (a rerun) still uses it. */
async function remove(job: Job): Promise<void> {
    if (job.result?.tableDataId) await tables.remove(job.result.tableDataId);
    const tx = await transaction([STORES.jobs, STORES.recipes], 'readwrite');
    tx.objectStore(STORES.jobs).delete(job.id!);
    const users = await req(tx.objectStore(STORES.jobs).index('recipeId').count(IDBKeyRange.only(job.recipeId)));
    if (users === 0) tx.objectStore(STORES.recipes).delete(job.recipeId);
    await done(tx);
}

async function get(id: number): Promise<Job | null> {
    const tx = await transaction(STORES.jobs);
    return (await req(tx.objectStore(STORES.jobs).get(id))) ?? null;
}

export const jobs = { createRecipe, getRecipe, create, get, update, list, remove };
