/** Recipes, their labels and the log of every label move. */
import { done, req } from '../../shared/db/idb';
import { proTransaction } from './idb';
import { STORES } from './schema';
import type { LabelMove, LabelName, MatchRules, ProRecipe, RecipeKind, Sample, Targeting } from '../recipe/types';

export async function createRecipe(input: { name: string; site: string; kind: RecipeKind } & Targeting): Promise<ProRecipe> {
    const now = Date.now();
    const recipe: ProRecipe = { id: crypto.randomUUID(), ...cleanTargeting(input), name: input.name, site: input.site, kind: input.kind, latestVersion: 0, labels: {}, createdAt: now, updatedAt: now };
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

function cleanRules(rules?: MatchRules): MatchRules | undefined {
    const tidy = (globs?: string[]) => [...new Set((globs ?? []).map(g => g.trim()).filter(Boolean))];
    const include = tidy(rules?.include), exclude = tidy(rules?.exclude);
    return include.length ? { include, ...(exclude.length ? { exclude } : {}) } : undefined;
}

/** Trimmed, with empty parts left out rather than stored blank. */
function cleanTargeting({ competitor, pageType, matchRules }: Targeting): Targeting {
    const rules = cleanRules(matchRules);
    return {
        ...(competitor?.trim() ? { competitor: competitor.trim().toLowerCase() } : {}),
        ...(pageType?.trim() ? { pageType: pageType.trim().toLowerCase() } : {}),
        ...(rules ? { matchRules: rules } : {}),
    };
}

/** Sets the competitor, page type and match rules; a part left empty is cleared. */
export async function setTargeting(id: string, targeting: Targeting): Promise<ProRecipe> {
    const tx = await proTransaction(STORES.recipes, 'readwrite');
    const store = tx.objectStore(STORES.recipes);
    const recipe = await req<ProRecipe | undefined>(store.get(id));
    if (!recipe) throw new Error(`No recipe ${id}`);
    const { competitor: _, pageType: __, matchRules: ___, ...rest } = recipe;
    const updated: ProRecipe = { ...rest, ...cleanTargeting(targeting), updatedAt: Date.now() };
    store.put(updated);
    await done(tx);
    return updated;
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
