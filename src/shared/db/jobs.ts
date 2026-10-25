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

/** A recipe's name (what the Recipes screen shows); its spec and revision stay. */
async function renameRecipe(id: number, name: string): Promise<void> {
    const tx = await transaction(STORES.recipes, 'readwrite');
    const store = tx.objectStore(STORES.recipes);
    const current: Recipe | undefined = await req(store.get(id));
    if (!current) throw new Error(`Recipe ${id} not found`);
    store.put({ ...current, name: name.trim() || current.name, updatedAt: Date.now() });
    await done(tx);
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

/** A recipe with how often it ran: its newest run, and the newest that wrote data. */
export interface RecipeRuns {
    recipe: Recipe;
    runs: number;
    last?: JobWithRecipe;
    lastWithData?: JobWithRecipe;
}

/** Every saved recipe (not only those of recent jobs), each with its runs. */
async function listRecipes(): Promise<RecipeRuns[]> {
    const tx = await transaction([STORES.jobs, STORES.recipes]);
    const all: Recipe[] = await req(tx.objectStore(STORES.recipes).getAll());
    const byRecipe = tx.objectStore(STORES.jobs).index('recipeId');
    const out: RecipeRuns[] = [];
    for (const recipe of all) {
        const range = IDBKeyRange.only(recipe.id!);
        const runs = await req(byRecipe.count(range));
        let last: JobWithRecipe | undefined, lastWithData: JobWithRecipe | undefined;
        // Newest first: job ids grow with each run.
        await walk<Job>(byRecipe.openCursor(range, 'prev'), j => {
            last ??= { ...j, recipe };
            if (j.tableId !== undefined) lastWithData = { ...j, recipe };
            return !lastWithData;
        });
        out.push({ recipe, runs, last, lastWithData });
    }
    return out;
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

/** What the user set up on a table's columns, kept from one run of a recipe to the next. */
const COLUMN_SETUP = ['renames', 'removed', 'merges', 'typed', 'mapping'] as const;

/**
 * A new run of a recipe takes the column setup of the recipe's last table: renamed and removed
 * columns, merges, cleaned (typed) columns, the export mapping. Set up once, kept for every run. What
 * the new table already has of its own wins.
 */
async function carryColumnSetup(jobId: number, tableId: number): Promise<void> {
    const job = await get(jobId);
    if (!job) return;
    const tx = await transaction(STORES.jobs);
    const runs: Job[] = [];
    await walk<Job>(tx.objectStore(STORES.jobs).index('recipeId').openCursor(IDBKeyRange.only(job.recipeId)), j => { runs.push(j); });
    const previous = runs
        .filter(j => j.id !== jobId && j.tableId !== undefined && j.tableId !== tableId)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!previous) return;
    const [from, to] = await Promise.all([tables.get(previous.tableId!), tables.get(tableId)]);
    if (!from || !to) return;
    const carried: Record<string, unknown> = {};
    for (const k of COLUMN_SETUP) if (from.view[k] !== undefined && to.view[k] === undefined) carried[k] = from.view[k];
    if (Object.keys(carried).length === 0) return;
    await tables.update(tableId, { view: carried });
    // Renamed and removed columns applied to this table's columns too.
    await tables.setColumns(tableId, to.columns);
}

export const jobs = { saveRecipe, carryColumnSetup, reviseRecipe, renameRecipe, getRecipe, listRecipes, create, get, update, list, remove };
