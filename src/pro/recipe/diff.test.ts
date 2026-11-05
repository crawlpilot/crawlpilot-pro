import { describe, expect, it } from 'vitest';
import zara from '../../shared/samples/recipes/zara-product.json';
import type { ListSpec, PageSpec } from '../../shared/types/database';
import { outputDigest, specDigest } from './canonical';
import { conditionLabel, diffVersions } from './diff';
import { fromListSpec, fromPageSpec } from './fromPublic';
import { assignWayIds } from './wayIds';
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

    it('knows a renamed field by its id, and says what else changed in it', async () => {
        const b = structuredClone(base);
        const origin = field(b, 'origin');
        origin.name = 'country';
        origin.ways.push({ kind: 'selector', selector: '.country' });
        const d = diffVersions(await version(1, base), await version(2, b));
        expect(d.changes).toContainEqual({ kind: 'renamed', subject: 'field origin → country', details: ['way added: .country'] });
        expect(d.changes.filter(c => c.kind === 'added' || c.kind === 'removed')).toEqual([]);
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

    it('notices page rules and the identity check', async () => {
        const rule = { name: '404', status: 'not_found' as const, when: { kind: 'css' as const, selector: '.gone', op: 'gt' as const, value: 0 } };
        const b: PageRecipeSpec = { ...structuredClone(base), rules: [rule], identity: { field: 'title', url: ['\\d+'] } };
        const d = diffVersions(await version(1, base), await version(2, b));
        expect(d.changes).toContainEqual({ kind: 'added', subject: 'page rule 404', details: ['not_found: when ".gone" is on the page'] });
        expect(d.changes).toContainEqual({ kind: 'changed', subject: 'identity check', details: ['none → title (1 URL pattern)'] });
        const c = { ...b, identity: { field: 'title', url: ['\\w+'] } };
        expect(diffVersions(await version(2, b), await version(3, c)).changes).toEqual([{ kind: 'changed', subject: 'identity check', details: ['its URL patterns changed'] }]);
    });

    it('says a condition in one line', () => {
        expect(conditionLabel({ kind: 'any', of: [
            { kind: 'css', selector: '#a', op: 'gt', value: 0 },
            { kind: 'all', of: [{ kind: 'regex', pattern: 'Sold out', op: 'eq', value: 0 }, { kind: 'not', of: { kind: 'css', selector: '#c', op: 'lt', value: 2 } }] },
        ] })).toBe('#a > 0 OR (/Sold out/ = 0 AND NOT (#c < 2))');
        expect(conditionLabel({ kind: 'any', of: [] })).toBe('never');
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

describe('diff and way ids', () => {
    it('sees no change when only the ways ids differ', async () => {
        const spec = fromPageSpec(zara.spec as unknown as PageSpec).spec;
        const withIds = assignWayIds(spec, 1);
        expect(diffVersions(await version(1, withIds), await version(2, spec)).changes).toEqual([]);
    });
});

describe('page rules and the identity check in a diff', () => {
    const rule = (name: string, pattern: string, status: 'not_found' | 'blocked' = 'not_found') =>
        ({ name, status, when: { kind: 'regex' as const, in: 'text' as const, pattern, flags: 'i', op: 'gt' as const, value: 0 } });
    const page = (over: Partial<PageRecipeSpec>): PageRecipeSpec => ({ kind: 'page', steps: [], ...over });

    it('names rules added, removed, changed and moved', async () => {
        const a = await version(1, page({ rules: [rule('404', 'Not found'), rule('Captcha', 'robot')] }));
        const b = await version(2, page({ rules: [rule('Captcha', 'robot', 'blocked'), rule('Gone', 'no longer')] }));
        expect(diffVersions(a, b).changes).toEqual([
            { kind: 'changed', subject: 'page rule Captcha', details: ['status not_found → blocked'] },
            { kind: 'added', subject: 'page rule Gone', details: ['not_found: when the visible text has "no longer"'] },
            { kind: 'removed', subject: 'page rule 404', details: [] },
        ]);
        const c = await version(3, page({ rules: [rule('Gone', 'no longer'), rule('Captcha', 'robot', 'blocked')] }));
        expect(diffVersions(b, c).changes).toEqual([{ kind: 'moved', subject: 'page rules', details: ['order: Gone, Captcha'] }]);
    });

    it('names a list\'s rules too', async () => {
        const list = { kind: 'list' as const, lists: [], pagination: { mode: 'auto' as const } };
        const l1 = await version(1, list), l2 = await version(2, { ...list, rules: [rule('No results', 'No results')] });
        expect(diffVersions(l1, l2).changes.map(c => c.subject)).toEqual(['page rule No results']);
    });
});
