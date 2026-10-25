import { describe, expect, it } from 'vitest';
import { healthOf, recipeEntries } from './recipes';
import type { JobWithRecipe } from './jobFilters';

const recipe = (id: number, name: string) => ({ id, name, spec: { kind: 'list', lists: [], pagination: { mode: 'auto' } }, hash: String(id), rev: 1, createdAt: 0, updatedAt: 0 }) as any;
const job = (id: number, r: any, at: number, extra: Partial<JobWithRecipe> = {}, stats: any = {}): JobWithRecipe => ({
    id, recipeId: r.id, recipeRev: 1, recipe: r, status: 'completed', input: { urls: ['https://www.shop.test/lamps'] },
    stats: { startTime: at, itemsExtracted: 12, ...stats }, tableId: id * 10, createdAt: at, updatedAt: at, ...extra,
}) as JobWithRecipe;

describe('recipes', () => {
    it('one entry per recipe, newest run first, with the site; a recipe not run yet too', () => {
        const a = recipe(1, 'Lamps'), b = recipe(2, 'Chairs'), c = { ...recipe(3, 'Desks'), updatedAt: 150 };
        const entries = recipeEntries([
            { recipe: a, runs: 2, last: job(3, a, 200, { tableId: undefined, status: 'running' }), lastWithData: job(1, a, 100) },
            { recipe: b, runs: 1, last: job(2, b, 300), lastWithData: job(2, b, 300) },
            { recipe: c, runs: 0 },
        ]);
        expect(entries.map(e => [e.recipe.name, e.runs, e.site])).toEqual([['Chairs', 1, 'shop.test'], ['Lamps', 2, 'shop.test'], ['Desks', 0, '']]);
        // The newest run is running; its data is the one before.
        expect(entries[1].health).toBe('running');
        expect(entries[1].lastWithData?.id).toBe(1);
        // Not run yet: no health, no data.
        expect(entries[2]).toMatchObject({ health: undefined, last: undefined, notes: [] });
    });

    it('health: failed and broken fields are bad; healed, sparse, failed pages and walls a warning', () => {
        const r = recipe(1, 'x');
        expect(healthOf(job(1, r, 1))).toEqual({ health: 'good', notes: [] });
        expect(healthOf(job(1, r, 1, { status: 'failed', error: 'Every page failed' }))).toMatchObject({ health: 'bad', notes: ['Failed: Every page failed'] });
        expect(healthOf(job(1, r, 1, {}, { itemsExtracted: 0 })).notes).toEqual(['No rows read']);
        const broken = healthOf(job(1, r, 1, {}, { pageStats: [{ page: 1, rows: 4, duplicates: 0, broken: ['Price'], healed: ['Title'] }] }));
        expect(broken).toEqual({ health: 'bad', notes: ['Price could not be found', 'Title found again by meaning'] });
        const warned = healthOf(job(1, r, 1, {}, { coverage: [{ name: 'Rating', fill: 0.3 }, { name: 'Title', fill: 1 }], errors: 2, verdicts: { ok: 8, login_wall: 1 } }));
        expect(warned).toEqual({ health: 'warn', notes: ['Rating 30% filled', '2 pages failed', '1 login wall'] });
        expect(healthOf(job(1, r, 1, {}, { stoppedByUser: true, itemsExtracted: 0 }))).toEqual({ health: 'warn', notes: ['Stopped before the end'] });
    });
});
