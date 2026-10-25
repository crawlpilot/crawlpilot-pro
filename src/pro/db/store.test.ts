import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import uniqlo from '../../shared/samples/recipes/uniqlo-product.json';
import zara from '../../shared/samples/recipes/zara-product.json';
import { pro, SaveRefused } from './index';
import { closeProDatabase } from './idb';
import { readRecipeFile, writeRecipeFile } from '../recipe/file';
import type { VersionDraft } from '../recipe/types';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(async () => { await closeProDatabase(); });

const draftOf = (file: object): VersionDraft => {
    const { note: _, ...draft } = readRecipeFile(JSON.stringify(file)).versions[0];
    return draft;
};
const by = { note: 'v', origin: 'built' as const, author: 'tester' };

/** The draft with one more selector on `origin`: a real edit. */
function edited(draft: VersionDraft, selector = '.origin'): VersionDraft {
    const next = structuredClone(draft);
    if (next.spec.kind !== 'page') throw new Error('page spec expected');
    const step = next.spec.steps.find(s => s.kind === 'field' && s.field.name === 'origin')!;
    if (step.kind === 'field') step.field.ways.push({ kind: 'selector', selector });
    return next;
}

describe('versions', () => {
    it('are numbered, linked to their parent and move latest', async () => {
        const recipe = await pro.recipes.create({ name: 'ZARA', site: 'zara.com', kind: 'page' });
        const v1 = await pro.versions.save(recipe.id, 0, draftOf(zara), { ...by, note: 'first' });
        const v2 = await pro.versions.save(recipe.id, 1, edited(v1), { ...by, origin: 'edited', note: 'origin fallback' });

        expect([v1.version, v2.version]).toEqual([1, 2]);
        expect(v1.parentVersion).toBeUndefined();
        expect(v2).toMatchObject({ parentVersion: 1, parentDigest: v1.digest, origin: 'edited', note: 'origin fallback' });
        expect(v2.digest).not.toBe(v1.digest);
        expect(v2.outputDigest).toBe(v1.outputDigest);
        expect(await pro.recipes.get(recipe.id)).toMatchObject({ latestVersion: 2, labels: { latest: 2 } });
        expect((await pro.versions.list(recipe.id)).map(v => v.version)).toEqual([2, 1]);
        expect((await pro.recipes.labelLog(recipe.id)).map(m => [m.label, m.from, m.to])).toEqual([['latest', 1, 2], ['latest', undefined, 1]]);
    });

    it('refuse a save from a stale base and leave the store as it was', async () => {
        const recipe = await pro.recipes.create({ name: 'ZARA', site: 'zara.com', kind: 'page' });
        const v1 = await pro.versions.save(recipe.id, 0, draftOf(zara), by);
        await pro.versions.save(recipe.id, 1, edited(v1, '.a'), by);

        const stale = pro.versions.save(recipe.id, 1, edited(v1, '.b'), by);
        await expect(stale).rejects.toBeInstanceOf(SaveRefused);
        await expect(stale).rejects.toMatchObject({ reason: 'stale', latest: 2 });
        expect(await pro.versions.list(recipe.id)).toHaveLength(2);
        expect((await pro.recipes.get(recipe.id))?.latestVersion).toBe(2);
    });

    it('refuse a save that changes nothing, but not one that only changes settings', async () => {
        const recipe = await pro.recipes.create({ name: 'ZARA', site: 'zara.com', kind: 'page' });
        const v1 = await pro.versions.save(recipe.id, 0, draftOf(zara), by);
        await expect(pro.versions.save(recipe.id, 1, draftOf(zara), by)).rejects.toMatchObject({ reason: 'unchanged' });

        const slower = { ...draftOf(zara), settings: { ...v1.settings, requestDelay: 3000 } };
        const v2 = await pro.versions.save(recipe.id, 1, slower, by);
        expect(v2.digest).toBe(v1.digest);
    });

    it('restore an old version as a new one', async () => {
        const recipe = await pro.recipes.create({ name: 'ZARA', site: 'zara.com', kind: 'page' });
        const v1 = await pro.versions.save(recipe.id, 0, draftOf(zara), by);
        await pro.versions.save(recipe.id, 1, edited(v1), by);
        const v3 = await pro.versions.restore(recipe.id, 1, 'tester');
        expect(v3).toMatchObject({ version: 3, origin: 'restored', digest: v1.digest, parentVersion: 2 });
        expect(await pro.versions.get(recipe.id, 1)).toEqual(v1);
    });
});

describe('labels', () => {
    it('move to an existing version only, and are logged', async () => {
        const recipe = await pro.recipes.create({ name: 'ZARA', site: 'zara.com', kind: 'page' });
        const v1 = await pro.versions.save(recipe.id, 0, draftOf(zara), by);
        await pro.versions.save(recipe.id, 1, edited(v1), by);
        await pro.recipes.moveLabel(recipe.id, 'live', 2, 'tester', 'ship');
        await pro.recipes.moveLabel(recipe.id, 'live', 1, 'tester', 'roll back');
        await expect(pro.recipes.moveLabel(recipe.id, 'live', 9, 'tester', 'x')).rejects.toThrow('No version 9');

        expect((await pro.recipes.get(recipe.id))?.labels).toEqual({ latest: 2, live: 1 });
        expect((await pro.recipes.labelLog(recipe.id))[0]).toMatchObject({ label: 'live', from: 2, to: 1, reason: 'roll back' });
    });
});

describe('import', () => {
    it('brings in both samples as version 1 with their sample pages', async () => {
        for (const file of [uniqlo, zara]) {
            const { recipe, added } = await pro.importRecipeFile(JSON.stringify(file), 'tester');
            expect(added).toBe(1);
            expect(recipe).toMatchObject({ name: file.name, site: file.site, latestVersion: 1, labels: { latest: 1 } });
            expect((await pro.versions.get(recipe.id, 1))?.origin).toBe('imported');
            expect((await pro.samples.list(recipe.id)).map(s => s.url)).toEqual([file.built_on, ...file.checked_on]);
        }
        expect(await pro.recipes.list()).toHaveLength(2);
    });

    it('adds only the versions a recipe does not have', async () => {
        const { recipe } = await pro.importRecipeFile(JSON.stringify(zara), 'tester');
        const v1 = (await pro.versions.get(recipe.id, 1))!;
        await pro.versions.save(recipe.id, 1, edited(v1), by);
        const raw = writeRecipeFile((await pro.recipes.get(recipe.id))!, await pro.versions.list(recipe.id), []);

        expect((await pro.importRecipeFile(raw, 'tester')).added).toBe(0);
        expect((await pro.importRecipeFile(JSON.stringify(zara), 'tester')).added).toBe(0);
        expect(await pro.recipes.list()).toHaveLength(1);
    });
});
