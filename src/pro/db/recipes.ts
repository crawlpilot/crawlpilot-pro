/** Recipes, their labels and the log of every label move. */
import { done, req } from '../../shared/db/idb';
import { proTransaction } from './idb';
import { STORES } from './schema';
import type { LabelMove, LabelName, ProRecipe, RecipeKind, Sample } from '../recipe/types';

export async function createRecipe(input: { name: string; site: string; kind: RecipeKind }): Promise<ProRecipe> {
    const now = Date.now();
    const recipe: ProRecipe = { id: crypto.randomUUID(), ...input, latestVersion: 0, labels: {}, createdAt: now, updatedAt: now };
    const tx = await proTransaction(STORES.recipes, 'readwrite');
    tx.objectStore(STORES.recipes).add(recipe);
    await done(tx);
    return recipe;
}

export async function getRecipe(id: string): Promise<ProRecipe | undefined> {
    const tx = await proTransaction(STORES.recipes);
    return req<ProRecipe | undefined>(tx.objectStore(STORES.recipes).get(id));
}

/** Every recipe, the most recently changed first. */
export async function listRecipes(): Promise<ProRecipe[]> {
    const tx = await proTransaction(STORES.recipes);
    const all = await req<ProRecipe[]>(tx.objectStore(STORES.recipes).getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The backend's id for the recipe, set on the first submit. */
export async function setRemoteId(id: string, remoteId: string): Promise<void> {
    const tx = await proTransaction(STORES.recipes, 'readwrite');
    const store = tx.objectStore(STORES.recipes);
    const recipe = await req<ProRecipe | undefined>(store.get(id));
    if (!recipe) throw new Error(`No recipe ${id}`);
    store.put({ ...recipe, remoteId });
    await done(tx);
}

export async function renameRecipe(id: string, name: string): Promise<void> {
    const tx = await proTransaction(STORES.recipes, 'readwrite');
    const store = tx.objectStore(STORES.recipes);
    const recipe = await req<ProRecipe | undefined>(store.get(id));
    if (!recipe) throw new Error(`No recipe ${id}`);
    store.put({ ...recipe, name, updatedAt: Date.now() });
    await done(tx);
}

/** Points a label at a version, logged with who and why. `latest` moves only on save. */
export async function moveLabel(recipeId: string, label: Exclude<LabelName, 'latest'>, to: number, by: string, reason: string): Promise<void> {
    const tx = await proTransaction([STORES.recipes, STORES.versions, STORES.labelLog], 'readwrite');
    const recipes = tx.objectStore(STORES.recipes);
    const recipe = await req<ProRecipe | undefined>(recipes.get(recipeId));
    if (!recipe) throw new Error(`No recipe ${recipeId}`);
    if (!await req(tx.objectStore(STORES.versions).getKey([recipeId, to]))) throw new Error(`No version ${to}`);
    const move: LabelMove = { recipeId, label, from: recipe.labels[label], to, by, at: Date.now(), reason };
    recipes.put({ ...recipe, labels: { ...recipe.labels, [label]: to }, updatedAt: move.at });
    tx.objectStore(STORES.labelLog).add(move);
    await done(tx);
}

/** A recipe's label moves, the newest first. */
export async function labelLog(recipeId: string): Promise<LabelMove[]> {
    const tx = await proTransaction(STORES.labelLog);
    const moves = await req<LabelMove[]>(tx.objectStore(STORES.labelLog).index('recipeId').getAll(recipeId));
    return moves.reverse();
}

export async function addSamples(recipeId: string, urls: string[]): Promise<void> {
    const tx = await proTransaction(STORES.samples, 'readwrite');
    const store = tx.objectStore(STORES.samples);
    const now = Date.now();
    // One millisecond apart, so they list in the order given.
    [...new Set(urls)].forEach((url, i) => store.put({ recipeId, url, addedAt: now + i } satisfies Sample));
    await done(tx);
}

export async function listSamples(recipeId: string): Promise<Sample[]> {
    const tx = await proTransaction(STORES.samples);
    const samples = await req<Sample[]>(tx.objectStore(STORES.samples).index('recipeId').getAll(recipeId));
    return samples.sort((a, b) => a.addedAt - b.addedAt);
}

export async function removeSample(recipeId: string, url: string): Promise<void> {
    const tx = await proTransaction(STORES.samples, 'readwrite');
    tx.objectStore(STORES.samples).delete([recipeId, url]);
    await done(tx);
}
