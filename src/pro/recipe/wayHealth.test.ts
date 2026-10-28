import { describe, expect, it } from 'vitest';
import type { PageRecipeSpec, Way } from './types';
import { wayHealth, type WayState } from './wayHealth';
import { cleanupKey, proposeCleanup } from './cleanup';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const OLD = Date.parse('2026-08-01T00:00:00Z');
const sel = (id: string, selector: string, addedIn = 1): Way => ({ id, addedIn, kind: 'selector', selector });
const data: Way = { id: 'd', addedIn: 1, kind: 'data', binding: { kind: 'ld', type: 'Product', path: [], key: 'price' } as never };
const field = (name: string, ways: Way[], required = false) => ({ kind: 'field' as const, field: { id: name, name, type: 'text' as const, read: 'text', ways, ops: [], ...(required ? { required } : {}) } });
const day = (wayId: string, date: string, tried: number, matched: number, won: number) => ({ wayId, date, tried, matched, won });

describe('way health', () => {
    const spec: PageRecipeSpec = { kind: 'page', steps: [
        field('price', [sel('a', '.price'), sel('b', '.old-price'), sel('c', '.gone'), sel('e', '.fresh', 3), sel('f', '.never'), sel('h', '.broken', 3)]),
        { kind: 'click', click: { id: 'k', name: 'Composition', ways: [sel('g', 'button.more')] } },
    ] };
    const days = [
        day('a', '2026-10-20', 100, 98, 98), day('a', '2026-08-01', 50, 50, 50),
        day('b', '2026-10-20', 100, 90, 0),
        day('c', '2026-10-20', 100, 0, 0), day('c', '2026-08-02', 40, 40, 40),
        day('e', '2026-10-20', 5, 0, 0), day('f', '2026-10-20', 19, 0, 0),
        day('h', '2026-10-20', 100, 0, 0),
        day('g', '2026-10-21', 100, 100, 100),
    ];
    const dates = new Map([[1, OLD], [3, Date.parse('2026-10-15T00:00:00Z')]]);

    it('labels each way from its last 30 days once tried on enough pages, and keeps when it last won', () => {
        const [price, click] = wayHealth(spec, days, dates, NOW);
        // e is new and seen on too few pages; h is just as new but broke on 100 pages; f is old but barely tried.
        expect(price.ways.map(w => [w.way.id, w.state])).toEqual([['a', 'active'], ['b', 'dormant'], ['c', 'dead'], ['e', 'new'], ['f', 'no-data'], ['h', 'dead']]);
        expect(price.ways[0]).toMatchObject({ tried: 100, matched: 98, won: 98, lastWonAt: '2026-10-20' });
        expect(price.ways[2]).toMatchObject({ won: 0, lastWonAt: '2026-08-02' });
        expect(click).toMatchObject({ owner: 'click: Composition', ways: [{ state: 'active' }] });
    });

    it('feeds a cleanup: dead removed, dormant moved last; new and unknown ways stay', () => {
        const states = new Map(wayHealth(spec, days, dates, NOW).flatMap(o => o.ways.map(w => [w.way.id!, w.state] as const)));
        const { spec: next, changes } = proposeCleanup(spec, states);
        expect(changes.map(c => [c.way.id, c.action])).toEqual([['h', 'removed'], ['c', 'removed'], ['b', 'moved last']]);
        const ways = (next as PageRecipeSpec).steps[0].kind === 'field' ? ((next as PageRecipeSpec).steps[0] as ReturnType<typeof field>).field.ways : [];
        expect(ways.map(w => w.id)).toEqual(['a', 'e', 'f', 'b']);
    });
});

describe('cleanup', () => {
    const states = (entries: [string, WayState][]) => new Map(entries);
    const ids = (spec: PageRecipeSpec) => spec.steps.map(s => (s.kind === 'field' ? s.field.ways : s.click.ways).map(w => w.id));

    it('never leaves a field without a way', () => {
        const spec: PageRecipeSpec = { kind: 'page', steps: [field('title', [sel('a', 'h1'), sel('b', '.t')])] };
        const { spec: next, changes } = proposeCleanup(spec, states([['a', 'dead'], ['b', 'dead']]));
        expect(ids(next as PageRecipeSpec)).toEqual([['a']]);
        expect(changes).toHaveLength(1);
    });

    it('keeps a required field at 2 ways, and at 2 kinds when it had them', () => {
        const spec: PageRecipeSpec = { kind: 'page', steps: [
            field('price', [data, sel('a', '.p'), sel('b', '.q')], true),
            field('sku', [sel('x', '.sku'), sel('y', '.code'), sel('z', '.id')], true),
        ] };
        const { spec: next } = proposeCleanup(spec, states([['d', 'dead'], ['a', 'active'], ['b', 'dead'], ['x', 'active'], ['y', 'dead'], ['z', 'dead']]));
        // price: page data is the only other kind, so it stays; .q goes. sku: one dead stays to keep 2.
        expect(ids(next as PageRecipeSpec)).toEqual([['d', 'a'], ['x', 'y']]);
    });

    it('moves only dormant selectors, never page data, and changes nothing when nothing is due', () => {
        const spec: PageRecipeSpec = { kind: 'page', steps: [field('price', [data, sel('a', '.p'), sel('b', '.q')])] };
        expect(ids(proposeCleanup(spec, states([['d', 'dormant'], ['a', 'dormant'], ['b', 'active']])).spec as PageRecipeSpec)).toEqual([['d', 'b', 'a']]);
        const same = proposeCleanup(spec, states([['a', 'active'], ['b', 'dormant']]));
        expect(same).toEqual({ spec, changes: [] });
    });

    it('leaves out a change someone chose to keep, and only that one', () => {
        const spec: PageRecipeSpec = { kind: 'page', steps: [field('price', [sel('a', '.p'), sel('b', '.q'), sel('c', '.r'), sel('e', '.s')])] };
        const all = states([['a', 'active'], ['b', 'dormant'], ['c', 'dead'], ['e', 'dead']]);
        const kept = new Set([cleanupKey('c', 'removed'), cleanupKey('b', 'moved last')]);
        const { spec: next, changes } = proposeCleanup(spec, all, kept);
        expect(changes.map(c => [c.way.id, c.action])).toEqual([['e', 'removed']]);
        expect(ids(next as PageRecipeSpec)).toEqual([['a', 'b', 'c']]);
    });

    it('never tries a dead way that stays before one that finds something', () => {
        const spec: PageRecipeSpec = { kind: 'page', steps: [field('title', [sel('a', 'h1'), sel('d', '.gone'), sel('b', '.alt')])] };
        const { spec: next, changes } = proposeCleanup(spec, states([['a', 'active'], ['d', 'dead'], ['b', 'dormant']]), new Set([cleanupKey('d', 'removed')]));
        expect(ids(next as PageRecipeSpec)).toEqual([['a', 'b', 'd']]);
        expect(changes.map(c => [c.way.id, c.action, c.state])).toEqual([['d', 'moved last', 'dead']]);
    });
});
