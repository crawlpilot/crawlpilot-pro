import { describe, it, expect } from 'vitest';
import { dataEntries, searchEntries } from './myData';
import type { Table } from '@/shared/types/database';
import type { JobWithRecipe } from '@/shared/db';

const table = (id: number, over: Partial<Table> = {}): Table => ({
    id, name: `Table ${id}`, source: 'list', sourceUrl: `https://www.shop${id}.com/list`, columns: [], rowCount: 10,
    preview: false, view: {}, createdAt: id * 1000, updatedAt: id * 1000, ...over,
} as Table);
const job = (id: number, over: Partial<JobWithRecipe> = {}): JobWithRecipe => ({
    id, recipeId: 1, recipeRev: 1, status: 'completed', input: { urls: [`https://run${id}.com/`] },
    stats: { startTime: 0, itemsExtracted: 5 }, createdAt: id * 1000, ...over,
} as JobWithRecipe);

describe('My data entries', () => {
    it('one entry per saved table, with the status of its latest run, newest first', () => {
        const entries = dataEntries([table(1), table(2)], [job(5, { tableId: 1 }), job(9, { tableId: 1, status: 'running' })]);
        expect(entries.map(e => [e.key, e.status, e.site])).toEqual([['t1', 'running', 'shop1.com'], ['t2', 'ready', 'shop2.com']]);
    });

    it('runs without a table (failed, or still starting) show on their own; previews and empty leftovers do not', () => {
        const entries = dataEntries(
            [table(1, { preview: true }), table(2, { rowCount: 0 })],
            [job(3, { status: 'failed' }), job(4, { status: 'stopped', stats: { startTime: 0, itemsExtracted: 2, stoppedByUser: true } })],
        );
        expect(entries.map(e => [e.key, e.status, e.rows])).toEqual([['j4', 'stopped', 2], ['j3', 'failed', 5]]);
    });

    it('searches names and sites', () => {
        const entries = dataEntries([table(1, { name: 'Lamps' }), table(2, { name: 'Chairs' })], []);
        expect(searchEntries(entries, 'shop2').map(e => e.name)).toEqual(['Chairs']);
        expect(searchEntries(entries, 'lamp').map(e => e.name)).toEqual(['Lamps']);
    });
});
