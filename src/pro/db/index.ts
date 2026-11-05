/** Pro's store: recipes, versions, labels and samples, plus importing a recipe file into them. */
import { addSamples, createRecipe, expectRule, getRecipe, labelLog, listRecipes, listSamples, moveLabel, removeSample, renameRecipe, setRemoteId, setTargeting } from './recipes';
import { listCrawls, saveCrawl } from './crawls';
import { getVersion, listVersions, markSubmitted, restoreVersion, saveVersion } from './versions';
import { latestTest, saveTest } from './tests';
import { listReviews, reviewStates, reviewVersion } from './reviews';
import { listWayStats, saveWayStats } from './wayStats';
import { dismissCleanup, listDismissals } from './dismissals';
import { readRecipeFile } from '../recipe/file';
import { specDigest } from '../recipe/canonical';
import type { ProRecipe, Version } from '../recipe/types';

export { SaveRefused } from './versions';
export { ReviewRefused, reviewProblem, reviewReason, type ReviewInput } from './reviews';

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Imports a `.crawlpilot.json` into the recipe with the same name, site and kind (or a new one). A version
 * the recipe already has, by spec digest, settings, pages and output, is skipped. The file's own digests
 * are not trusted: each one is computed again. `notes`: what an Atlas export had that the recipe doesn't.
 */
async function importRecipeFile(raw: string, author: string): Promise<{ recipe: ProRecipe; added: number; notes: string[] }> {
    const file = readRecipeFile(raw);
    const existing = (await listRecipes()).find(r => r.name === file.name && r.site === file.site && r.kind === file.kind);
    const recipe = existing ?? await createRecipe({ name: file.name, site: file.site, kind: file.kind, ...file.targeting });
    const have: Version[] = await listVersions(recipe.id);
    let latest = existing?.latestVersion ?? 0;
    let added = 0;
    for (const { note, digest: _, ...draft } of file.versions) {
        const digest = await specDigest(draft.spec);
        const known = have.some(v => v.digest === digest && sameJson(v.settings, draft.settings) && sameJson(v.pages, draft.pages) && sameJson(v.output, draft.output));
        if (known) continue;
        const saved = await saveVersion(recipe.id, latest, draft, { note, origin: 'imported', author });
        have.push(saved);
        latest = saved.version;
        added++;
    }
    if (file.samples.length > 0) await addSamples(recipe.id, file.samples, file.sampleRules);
    return { recipe: (await getRecipe(recipe.id))!, added, notes: file.notes ?? [] };
}

export const pro = {
    recipes: { create: createRecipe, get: getRecipe, list: listRecipes, rename: renameRecipe, moveLabel, labelLog, setRemoteId, setTargeting },
    versions: { save: saveVersion, get: getVersion, list: listVersions, restore: restoreVersion, markSubmitted },
    samples: { add: addSamples, list: listSamples, remove: removeSample, expectRule },
    tests: { save: saveTest, latest: latestTest },
    crawls: { save: saveCrawl, list: listCrawls },
    reviews: { review: reviewVersion, list: listReviews, states: reviewStates },
    wayStats: { save: saveWayStats, list: listWayStats },
    dismissals: { dismiss: dismissCleanup, list: listDismissals },
    importRecipeFile,
};
