/**
 * Versions are written once and never changed (`docs/design/LLD.md` §4.3): there is no update here. A save
 * names the version it was edited from; if another save got there first it is refused, never merged.
 */
import { done, req } from '../../shared/db/idb';
import { proTransaction } from './idb';
import { STORES } from './schema';
import { outputDigest, specDigest } from '../recipe/canonical';
import type { LabelMove, ProRecipe, Version, VersionDraft, VersionOrigin } from '../recipe/types';

export type SaveRefusal = 'stale' | 'unchanged' | 'missing';

export class SaveRefused extends Error {
    constructor(readonly reason: SaveRefusal, readonly latest?: number) {
        super(reason === 'stale' ? `Version ${latest} was saved since this edit began`
            : reason === 'unchanged' ? 'Nothing changed since the version this was edited from'
            : 'No such recipe');
    }
}

export interface SaveInput {
    note: string;
    origin: VersionOrigin;
    author: string;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Writes version `baseVersion + 1`, moves `latest` to it and drops the recipe's draft. */
export async function saveVersion(recipeId: string, baseVersion: number, draft: VersionDraft, input: SaveInput): Promise<Version> {
    // Digests first: awaiting anything but IndexedDB inside the transaction would let it commit.
    const [digest, outDigest] = await Promise.all([specDigest(draft.spec), outputDigest(draft.spec)]);
    const tx = await proTransaction([STORES.recipes, STORES.versions, STORES.labelLog, STORES.drafts], 'readwrite');
    const recipes = tx.objectStore(STORES.recipes);
    const versions = tx.objectStore(STORES.versions);
    const recipe = await req<ProRecipe | undefined>(recipes.get(recipeId));
    if (!recipe) { tx.abort(); throw new SaveRefused('missing'); }
    if (recipe.latestVersion !== baseVersion) { tx.abort(); throw new SaveRefused('stale', recipe.latestVersion); }
    const base = baseVersion > 0 ? await req<Version | undefined>(versions.get([recipeId, baseVersion])) : undefined;
    if (base && base.digest === digest && sameJson(base.settings, draft.settings) && sameJson(base.pages, draft.pages) && sameJson(base.output, draft.output)) {
        tx.abort();
        throw new SaveRefused('unchanged');
    }
    const now = Date.now();
    // Only the draft's own parts: a draft made from a loaded version still carries its number and digests.
    const { spec, settings, pages, output } = draft;
    const version: Version = {
        recipeId, version: baseVersion + 1, spec, settings, pages, output, digest, outputDigest: outDigest,
        ...(base ? { parentVersion: base.version, parentDigest: base.digest } : {}),
        origin: input.origin, note: input.note, author: input.author, createdAt: now,
    };
    versions.add(version);
    recipes.put({ ...recipe, latestVersion: version.version, labels: { ...recipe.labels, latest: version.version }, updatedAt: now });
    tx.objectStore(STORES.labelLog).add({ recipeId, label: 'latest', from: recipe.labels.latest, to: version.version, by: input.author, at: now, reason: input.note } satisfies LabelMove);
    tx.objectStore(STORES.drafts).delete(recipeId);
    await done(tx);
    return version;
}

export async function getVersion(recipeId: string, version: number): Promise<Version | undefined> {
    const tx = await proTransaction(STORES.versions);
    return req<Version | undefined>(tx.objectStore(STORES.versions).get([recipeId, version]));
}

/** A recipe's versions, the newest first. */
export async function listVersions(recipeId: string): Promise<Version[]> {
    const tx = await proTransaction(STORES.versions);
    const all = await req<Version[]>(tx.objectStore(STORES.versions).index('recipeId').getAll(recipeId));
    return all.sort((a, b) => b.version - a.version);
}

/** Marks a version submitted, once: the only change a saved version ever takes. */
export async function markSubmitted(recipeId: string, version: number, at = Date.now()): Promise<Version> {
    const tx = await proTransaction(STORES.versions, 'readwrite');
    const store = tx.objectStore(STORES.versions);
    const v = await req<Version | undefined>(store.get([recipeId, version]));
    if (!v) { tx.abort(); throw new Error(`No version ${version}`); }
    if (v.submittedAt) { await done(tx); return v; }
    const submitted = { ...v, submittedAt: at };
    store.put(submitted);
    await done(tx);
    return submitted;
}

/** An older version saved again as the newest: history is only ever added to. */
export async function restoreVersion(recipeId: string, version: number, author: string): Promise<Version> {
    const old = await getVersion(recipeId, version);
    if (!old) throw new Error(`No version ${version}`);
    const latest = (await listVersions(recipeId))[0]?.version ?? 0;
    const { spec, settings, pages, output } = old;
    return saveVersion(recipeId, latest, { spec, settings, pages, output }, { note: `Restored version ${version}`, origin: 'restored', author });
}
