import { describe, expect, it } from 'vitest';
import zara from '../../shared/samples/recipes/zara-product.json';
import type { PageSpec } from '../../shared/types/database';
import { specDigest } from './canonical';
import { fromPageSpec } from './fromPublic';
import type { Field, PageRecipeSpec } from './types';
import { assignWayIds, listWays } from './wayIds';

const counter = () => { let n = 0; return () => `w${++n}`; };
const base = () => fromPageSpec(zara.spec as unknown as PageSpec).spec;
const field = (spec: PageRecipeSpec, name: string): Field => spec.steps.flatMap(s => s.kind === 'field' && s.field.name === name ? [s.field] : [])[0];

describe('way ids', () => {
    it('are given to every way on the first save, first seen in that version, without changing the digest', async () => {
        const spec = base();
        const v1 = assignWayIds(spec, 1, undefined, counter()) as PageRecipeSpec;
        const ways = listWays(v1);
        expect(ways.length).toBeGreaterThan(0);
        expect(ways.every(({ way }) => way.id && way.addedIn === 1)).toBe(true);
        expect(new Set(ways.map(({ way }) => way.id)).size).toBe(ways.length);
        expect(await specDigest(v1)).toBe(await specDigest(spec));
    });

    it('carry over to the next version, also for a spec picked again without ids', () => {
        const v1 = assignWayIds(base(), 1, undefined, counter()) as PageRecipeSpec;
        const repicked = assignWayIds(base(), 2, v1, () => 'new') as PageRecipeSpec;
        expect(listWays(repicked).map(({ way }) => [way.id, way.addedIn])).toEqual(listWays(v1).map(({ way }) => [way.id, 1]));
    });

    it('are new for an added or changed selector, and kept by a renamed field', () => {
        const v1 = assignWayIds(base(), 1, undefined, counter()) as PageRecipeSpec;
        const draft = structuredClone(v1);
        const origin = field(draft, 'origin');
        origin.name = 'country_of_origin';
        origin.ways.push({ kind: 'selector', selector: '.origin' });
        const first = origin.ways[0];
        if (first.kind === 'selector') first.selector = `${first.selector} span`;

        const v2 = assignWayIds(draft, 2, v1, () => 'new') as PageRecipeSpec;
        const before = field(v1, 'origin').ways, after = field(v2, 'country_of_origin').ways;
        expect(after[after.length - 1]).toMatchObject({ id: 'new', addedIn: 2 });
        expect(after[0]).toMatchObject({ id: 'new', addedIn: 2 });
        expect(after.slice(1, -1).map(w => w.id)).toEqual(before.slice(1).map(w => w.id));
    });

    it('never reuse an id the base has under another field', () => {
        const v1 = assignWayIds(base(), 1, undefined, counter()) as PageRecipeSpec;
        const draft = structuredClone(v1);
        const stolen = field(draft, 'title').ways[0];
        field(draft, 'origin').ways.push({ ...stolen });
        const v2 = assignWayIds(draft, 2, v1, () => 'new') as PageRecipeSpec;
        expect(field(v2, 'title').ways[0].id).toBe(stolen.id);
        expect(field(v2, 'origin').ways.slice(-1)[0]?.id).toBe('new');
    });
});
