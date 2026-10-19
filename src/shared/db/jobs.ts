/** Recipes (what to extract) and jobs (runs of them). */
import type { Job, Recipe, RecipeSpec } from '../types/database';
import { specHash, specJson } from '../recipes/spec';
import { done, req, transaction, walk } from './idb';
import { STORES } from './schema';
import { tables } from './tables';

export type JobWithRecipe = Job & { recipe?: Recipe };

/**
 * The recipe for a spec: the one already saved with the same spec (running a pick again, a rerun),
 * otherwise a new one. Returns its id and revision.
 */
async function saveRecipe(name: string, spec: RecipeSpec): Promise<{ id: number; rev: number }> {
    const hash = specHash(spec);
    const json = specJson(spec);
    const tx = await transaction(STORES.recipes, 'readwrite');
    const store = tx.objectStore(STORES.recipes);
    const sameHash: Recipe[] = await req(store.index('hash').getAll(IDBKeyRange.only(hash)));
    const existing = sameHash.find(r => specJson(r.spec) === json);
    if (existing) return { id: existing.id!, rev: existing.rev };
    const now = Date.now();
    const id = await req(store.add({ name, spec, hash, rev: 1, createdAt: now, updatedAt: now } satisfies Recipe)) as number;
    return { id, rev: 1 };
}

/** Replaces a recipe's spec (an edit, a healed selector): its revision goes up; jobs keep the revision they ran. */
async function reviseRecipe(id: number, spec: RecipeSpec): Promise<number> {
    const tx = await transaction(STORES.recipes, 'readwrite');
    const store = tx.objectStore(STORES.recipes);
    const current: Recipe | undefined = await req(store.get(id));
    if (!current) throw new Error(`Recipe ${id} not found`);
    const rev = current.rev + 1;
    store.put({ ...current, spec, hash: specHash(spec), rev, updatedAt: Date.now() } satisfies Recipe);
    await done(tx);
    return rev;
}

async function getRecipe(id: number): Promise<Recipe | null> {
    const tx = await transaction(STORES.recipes);
    return (await req(tx.objectStore(STORES.recipes).get(id))) ?? null;
}

async function create(job: Job): Promise<number> {
    const tx = await transaction(STORES.jobs, 'readwrite');
    return await req(tx.objectStore(STORES.jobs).add(job)) as number;
}

async function get(id: number): Promise<Job | null> {
    const tx = await transaction(STORES.jobs);
    return (await req(tx.objectStore(STORES.jobs).get(id))) ?? null;
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
    const found: Job[] = [];
    await walk<Job>(tx.objectStore(STORES.jobs).index('createdAt').openCursor(null, 'prev'), j => {
        found.push(j);
        return found.length < limit;
    });
    const recipes = tx.objectStore(STORES.recipes);
    const byId = new Map<number, Recipe>();
    for (const id of new Set(found.map(j => j.recipeId))) {
        const recipe: Recipe | undefined = await req(recipes.get(id));
        if (recipe) byId.set(id, recipe);
    }
    return found.map(j => ({ ...j, recipe: byId.get(j.recipeId) }));
}

/** Deletes a job and its table; its recipe too, unless another job still uses it. */
async function remove(job: Job): Promise<void> {
    if (job.tableId) await tables.remove(job.tableId);
    const tx = await transaction([STORES.jobs, STORES.recipes], 'readwrite');
    tx.objectStore(STORES.jobs).delete(job.id!);
    const users = await req(tx.objectStore(STORES.jobs).index('recipeId').count(IDBKeyRange.only(job.recipeId)));
    if (users === 0) tx.objectStore(STORES.recipes).delete(job.recipeId);
    await done(tx);
}

export const jobs = { saveRecipe, reviseRecipe, getRecipe, create, get, update, list, remove };
