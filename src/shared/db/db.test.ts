import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './index';
import { closeDatabase } from './idb';
import type { Job } from '../types/database';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(async () => { await closeDatabase(); });

const result = (items: Record<string, any>[], columns = [{ id: 'title', name: 'Title', type: 'text' as const }]) =>
    ({ type: 'list', source_url: 'https://shop.test/s', columns, items });

const job = (recipeId: number, tableDataId?: number): Job => ({
    recipeId, status: 'completed', stats: { startTime: 1, itemsExtracted: 0 },
    ...(tableDataId ? { result: { tableDataId } } : {}), createdAt: Date.now(), updatedAt: Date.now(),
});

describe('db', () => {
    it('stores each row once, skips duplicates and counts what was stored', async () => {
        const id = await db.tables.save(result([{ title: 'A' }, { title: 'B' }, { title: 'A' }]), { name: 'Shop' });
        expect(await db.tables.rowCount(id)).toBe(2);
        const table = await db.tables.get(id);
        expect(table?.metadata?.totalRows).toBe(2);
        const rows = await db.tables.rowsPage(id, 0, 10);
        expect(rows.map(r => r.data)).toEqual([{ title: 'A' }, { title: 'B' }]);
        expect(rows[0]).not.toHaveProperty('metadata');

        expect(await db.tables.appendRows(id, [{ title: 'B' }, { title: 'C' }])).toBe(1);
        expect((await db.tables.get(id))?.metadata?.totalRows).toBe(3);
        expect((await db.tables.rowsPage(id, 1, 5)).map(r => r.data.title)).toEqual(['B', 'C']);
    });

    it('replaces columns instead of merging them, and renames one', async () => {
        const id = await db.tables.save(result([{ title: 'A' }], [{ id: 'old', name: 'Old', type: 'text' }]));
        await db.tables.save(result([], [{ id: 'title', name: 'Title', type: 'text' }]), { tableDataId: id, isPreview: false });
        expect((await db.tables.get(id))?.columns.map(c => c.id)).toEqual(['title']);
        await db.tables.setColumns(id, [{ id: 'title', name: 'Title', type: 'text' }]);
        await db.tables.renameColumn(id, 'title', 'Name');
        expect((await db.tables.get(id))?.columns).toEqual([{ id: 'title', name: 'Name', type: 'text' }]);
    });

    it('overwrites a preview, never another job\'s table', async () => {
        const preview = await db.tables.save(result([{ title: 'A' }]), { name: 'Shop', isPreview: true });
        const final = await db.tables.save(result([{ title: 'B' }]), { name: 'Shop', jobId: 7, tableDataId: preview, clearExisting: true });
        expect(final).toBe(preview);
        expect((await db.tables.get(final))?.name).toBe('Shop');
        expect((await db.tables.rowsPage(final, 0, 5)).map(r => r.data.title)).toEqual(['B']);

        const other = await db.tables.save(result([{ title: 'C' }]), { jobId: 8, tableDataId: final });
        expect(other).not.toBe(final);
    });

    it('keeps only the latest loose preview', async () => {
        const first = await db.tables.save(result([{ title: 'A' }]), { isPreview: true });
        const owned = await db.tables.save(result([{ title: 'B' }]), { isPreview: true, jobId: 3 });
        const second = await db.tables.save(result([{ title: 'C' }]), { isPreview: true });
        expect(await db.tables.get(first)).toBeNull();
        expect(await db.tables.rowCount(first)).toBe(0);
        expect(await db.tables.get(owned)).not.toBeNull();
        expect((await db.tables.list()).map(t => t.id)).toEqual([second, owned]);
    });

    it('deletes a job with its table, and its recipe only when no rerun uses it', async () => {
        const recipeId = await db.jobs.createRecipe({ name: 'r', type: 'list-extraction', version: 1, config: { type: 'list-extraction' }, createdAt: 1, updatedAt: 1 });
        const tableId = await db.tables.save(result([{ title: 'A' }]));
        const first = await db.jobs.create(job(recipeId, tableId));
        const rerun = await db.jobs.create(job(recipeId));

        await db.jobs.remove({ ...job(recipeId, tableId), id: first });
        expect(await db.tables.get(tableId)).toBeNull();
        expect(await db.jobs.getRecipe(recipeId)).not.toBeNull();
        expect((await db.jobs.list()).map(j => j.id)).toEqual([rerun]);

        await db.jobs.remove({ ...job(recipeId), id: rerun });
        expect(await db.jobs.getRecipe(recipeId)).toBeNull();
    });

    it('lists jobs newest first with their recipe, and clears everything', async () => {
        const recipeId = await db.jobs.createRecipe({ name: 'r', type: 'bulk-extraction', version: 1, config: { type: 'bulk-extraction' }, createdAt: 1, updatedAt: 1 });
        await db.jobs.create({ ...job(recipeId), createdAt: 1 });
        const newer = await db.jobs.create({ ...job(recipeId), createdAt: 2 });
        await db.jobs.update(newer, { status: 'failed' });
        const jobs = await db.jobs.list();
        expect(jobs.map(j => [j.id, j.status, j.recipe?.name])).toEqual([[newer, 'failed', 'r'], [1, 'completed', 'r']]);

        await db.clearAll();
        expect(await db.jobs.list()).toEqual([]);
    });
});
