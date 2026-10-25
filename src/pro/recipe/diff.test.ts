import { describe, expect, it } from 'vitest';
import zara from '../../shared/samples/recipes/zara-product.json';
import type { ListSpec, PageSpec } from '../../shared/types/database';
import { outputDigest, specDigest } from './canonical';
import { diffVersions } from './diff';
import { fromListSpec, fromPageSpec } from './fromPublic';
import type { Field, PageRecipeSpec, ProSpec, Version } from './types';

async function version(n: number, spec: ProSpec, settings: Record<string, unknown> = {}, urls = ['https://a.test/1']): Promise<Version> {
    return {
        recipeId: 'r', version: n, spec, settings, pages: { kind: 'urls', urls }, output: {},
        digest: await specDigest(spec), outputDigest: await outputDigest(spec), origin: 'edited', note: '', author: 't', createdAt: n,
    };
}

const base = fromPageSpec(zara.spec as unknown as PageSpec).spec;
const field = (s: PageRecipeSpec, name: string): Field => s.steps.flatMap(st => st.kind === 'field' && st.field.name === name ? [st.field] : [])[0];

describe('diffVersions, page recipes', () => {
    it('finds nothing between equal versions', async () => {
        const d = diffVersions(await version(1, base), await version(2, structuredClone(base)));
        expect(d.changes).toEqual([]);
        expect(d.outputChanged).toBe(false);
    });

    it('says which fields were added, removed, renamed and how one changed', async () => {
        const b = structuredClone(base);
        field(b, 'origin').ways.unshift({ kind: 'selector', selector: '.origin' });
        field(b, 'price').type = 'money';
        field(b, 'color').name = 'colour';
        b.steps = b.steps.filter(s => !(s.kind === 'field' && s.field.name === 'size'));
        b.steps.push({ kind: 'field', field: { id: 'n', name: 'rating', type: 'number', read: 'text', ways: [{ kind: 'selector', selector: '.stars' }], ops: [] } });

        const d = diffVersions(await version(1, base), await version(2, b));
        expect(d.changes).toContainEqual({ kind: 'added', subject: 'field rating', details: [] });
        expect(d.changes).toContainEqual({ kind: 'removed', subject: 'field size', details: [] });
        expect(d.changes).toContainEqual({ kind: 'renamed', subject: 'field color → colour', details: [] });
        expect(d.changes).toContainEqual({ kind: 'changed', subject: 'field price', details: ['type text → money'] });
        expect(d.changes).toContainEqual({ kind: 'changed', subject: 'field origin', details: ['way added: .origin'] });
        expect(d.outputChanged).toBe(true);
    });

    it('notices reordered ways and steps, settings and pages', async () => {
        const b = structuredClone(base);
        field(b, 'highlights').ways.reverse();
        const click = b.steps.findIndex(s => s.kind === 'click');
        b.steps.push(...b.steps.splice(click, 1));

        const d = diffVersions(await version(1, base, { requestDelay: 1000 }), await version(2, b, { requestDelay: 3000 }, ['https://a.test/1', 'https://a.test/2']));
        expect(d.changes).toContainEqual({ kind: 'changed', subject: 'field highlights', details: ['ways reordered'] });
        expect(d.changes).toContainEqual({ kind: 'moved', subject: 'steps', details: ['the run order changed'] });
        expect(d.changes).toContainEqual({ kind: 'changed', subject: 'settings', details: ['requestDelay 1000 → 3000'] });
        expect(d.changes).toContainEqual({ kind: 'changed', subject: 'pages', details: ['1 added, 0 removed (2 now)'] });
        expect(d.outputChanged).toBe(false);
    });
});

describe('diffVersions, list recipes', () => {
    const list: ListSpec = {
        kind: 'list',
        lists: [{ id: 'l', container: ['ul'], items: ['li'], mode: 'list', fields: [{ id: 'a', name: 'title', type: 'text', selector: 'h3' }, { id: 'b', name: 'price', type: 'text', selector: '.p' }] }],
        pagination: { mode: 'pagination', next: ['a.next'] },
    };

    it('compares sections, fields and pagination', async () => {
        const a = fromListSpec(list).spec;
        const b = structuredClone(a);
        b.lists[0].items = ['li.card'];
        b.lists[0].fields[1].type = 'price';
        b.lists[0].fields[0].name = 'name';
        b.pagination = { mode: 'loadMore', next: ['button.more'] };

        const d = diffVersions(await version(1, a), await version(2, b));
        expect(d.changes).toContainEqual({ kind: 'changed', subject: 'list 1', details: ['items li → li.card'] });
        expect(d.changes).toContainEqual({ kind: 'renamed', subject: 'list 1 field title → name', details: [] });
        expect(d.changes).toContainEqual({ kind: 'changed', subject: 'list 1 field price', details: ['type text → price'] });
        expect(d.changes).toContainEqual({ kind: 'changed', subject: 'pagination', details: ['mode pagination → loadMore', 'next a.next → button.more'] });
    });
});
