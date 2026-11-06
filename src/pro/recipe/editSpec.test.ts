import { describe, expect, it } from 'vitest';
import zara from '../../shared/samples/recipes/zara-product.json';
import type { PageSpec } from '../../shared/types/database';
import { fromPageSpec } from './fromPublic';
import { addSelector, onlyField, moveStep, moveWay, problems, removeStep, removeWay, renameField, setFieldType, setIdentity, setOps, setRequired, setRules, setWay } from './editSpec';
import type { Field, PageRecipeSpec } from './types';

const spec = fromPageSpec(zara.spec as unknown as PageSpec).spec;
const field = (s: PageRecipeSpec, name: string): Field => s.steps.flatMap(st => st.kind === 'field' && st.field.name === name ? [st.field] : [])[0];
const id = (name: string) => field(spec, name).id;

describe('editing a page recipe', () => {
    it('renames, retypes, requires and cleans a field without touching the original', () => {
        let s = renameField(spec, id('color'), 'colour');
        s = setFieldType(s, id('price'), 'money');
        s = setRequired(s, id('title'), true);
        s = setOps(s, id('origin'), [{ op: 'trim' }]);
        expect(field(s, 'colour')).toBeTruthy();
        expect(field(s, 'price').type).toBe('money');
        expect(field(s, 'title').required).toBe(true);
        expect(field(setRequired(s, id('title'), false), 'title')).not.toHaveProperty('required');
        expect(field(s, 'origin').ops).toEqual([{ op: 'trim' }]);
        expect(field(spec, 'color')).toBeTruthy();
    });

    it('moves and removes steps', () => {
        const click = spec.steps.findIndex(s => s.kind === 'click');
        const moved = moveStep(spec, click, -1);
        expect(moved.steps[click - 1].kind).toBe('click');
        expect(moveStep(spec, 0, -1).steps).toEqual(spec.steps);
        expect(removeStep(spec, click).steps.some(s => s.kind === 'click')).toBe(false);
    });

    it('keeps page data first: selectors move among themselves only', () => {
        const withData = field(spec, 'title');
        let s = addSelector(spec, withData.id, 'h1.title');
        s = addSelector(s, withData.id, 'h1.name');
        s = addSelector(s, withData.id, 'h1.name');
        expect(field(s, 'title').ways.map(w => w.kind)).toEqual(['data', 'selector', 'selector']);
        expect(field(moveWay(s, withData.id, 1, -1), 'title').ways[0].kind).toBe('data');
        expect(field(moveWay(s, withData.id, 2, -1), 'title').ways.map(w => w.kind === 'selector' ? w.selector : 'data')).toEqual(['data', 'h1.name', 'h1.title']);
        expect(field(removeWay(s, withData.id, 0), 'title').ways).toHaveLength(2);
    });

    it('lists what stops a save', () => {
        expect(problems(spec)).toEqual([]);
        let s = renameField(spec, id('color'), 'size');
        s = renameField(s, id('brand'), ' ');
        const origin = field(s, 'origin');
        s = origin.ways.reduce(acc => removeWay(acc, origin.id, 0), s);
        expect(problems(s)).toEqual(['Every field needs a name.', 'Two fields are named "size".', '"origin" has no way to find it.']);
        expect(problems({ kind: 'page', steps: [] })).toEqual(['The recipe has no fields.']);
    });

    it('sets a way, the page rules and the identity check, and drops them when emptied', () => {
        const title = field(spec, 'title');
        const s = setWay(spec, title.id, 0, { ...title.ways[0], pick: 'all' });
        expect(field(s, 'title').ways[0]).toMatchObject({ pick: 'all' });
        const rule = { name: '404', status: 'not_found' as const, when: { kind: 'css' as const, selector: '.gone', op: 'gt' as const, value: 0 } };
        expect(setRules(spec, [rule]).rules).toEqual([rule]);
        expect(setRules(setRules(spec, [rule]), [])).not.toHaveProperty('rules');
        expect(setIdentity(setIdentity(spec, { field: 'title', url: ['\\d+'] }), undefined)).not.toHaveProperty('identity');
    });

    it('refuses an identity check on no field, without patterns or with a broken one, and a rule without a name', () => {
        expect(problems(setIdentity(spec, { field: 'sku', url: [] }))).toEqual([
            'The identity check reads "sku", which is not a field.', 'The identity check has no URL pattern.',
        ]);
        expect(problems(setIdentity(spec, { field: 'title', url: ['a(b'] }))).toEqual(['URL pattern a(b is not a valid regex.']);
        expect(problems(setRules(spec, [{ name: ' ', status: 'error', when: { kind: 'any', of: [] } }]))).toEqual(['Every page rule needs a name.']);
    });
});

describe('a list recipe\'s page rules', () => {
    it('are set, dropped when none, and checked like a page recipe\'s', async () => {
        const { listProblems, setListRules } = await import('./editSpec');
        const list = { kind: 'list' as const, lists: [], pagination: { mode: 'auto' as const } };
        const ruled = setListRules(list, [{ name: 'Empty', status: 'not_found', when: { kind: 'regex', in: 'text', pattern: '', op: 'gt', value: 0 } }, { name: 'Empty', status: 'blocked', when: { kind: 'css', selector: '#c', op: 'gt', value: 0 } }]);
        expect(listProblems(ruled)).toEqual(['Two page rules are named "Empty".', 'Rule "Empty": a condition has nothing to look for.']);
        expect(setListRules(ruled, [])).toEqual(list);
    });
});

describe('one field alone', () => {
    it('keeps the steps before it and the page rules, and leaves out the other fields, identity and transform', () => {
        const f = (id: string): Field => ({ id, name: id, type: 'text', read: 'text', ways: [], ops: [] });
        const click = (id: string) => ({ kind: 'click' as const, click: { id, name: id, selectors: ['button'] } });
        const spec = {
            kind: 'page', steps: [{ kind: 'field', field: f('a') }, click('open'), { kind: 'field', field: f('b') }, click('later'), { kind: 'field', field: f('c') }],
            rules: [{ name: 'gone', status: 'not-found', when: { kind: 'css', selector: '.gone' } }],
            identity: { field: 'a', patterns: ['/p/(\\d+)'] }, transform: { jolt: [{ operation: 'shift', spec: { a: 'x' } }] },
        } as unknown as PageRecipeSpec;
        const one = onlyField(spec, 'b');
        expect(one.steps.map(s => s.kind === 'field' ? s.field.id : s.click.id)).toEqual(['open', 'b']);
        expect(one.rules).toEqual(spec.rules);
        expect(one.identity).toBeUndefined();
        expect(one.transform).toBeUndefined();
        expect(() => onlyField(spec, 'nope')).toThrow();
    });
});
