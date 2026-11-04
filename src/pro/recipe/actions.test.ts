import { describe, expect, it } from 'vitest';
import { describeAction, fillVariables, isProAction, MissingVariable, missingVariables, segments, variablesOf } from './actions';
import { diffVersions } from './diff';
import { actionProblems, problems } from './editSpec';
import type { Click, PageRecipeSpec, Version } from './types';
import { assignWayIds, listWays } from './wayIds';

const sel = (selector: string) => ({ kind: 'selector' as const, selector });
const act = (id: string, extra: Partial<Click> = {}): Click => ({ id, name: id, ways: [sel(`#${id}`)], ...extra });
const field = (id: string) => ({ kind: 'field' as const, field: { id, name: id, type: 'text' as const, read: 'text', ops: [], ways: [sel(`.${id}`)] } });

const spec: PageRecipeSpec = {
    kind: 'page',
    setup: {
        steps: [act('open'), act('zip', { do: 'type', value: '{zip}' }), act('store', { do: 'choose', value: '{store} store' })],
        dismiss: [act('consent')],
        check: { ways: [sel('#loc')], contains: 'Deliver to {zip}' },
    },
    steps: [field('title'), { kind: 'click', click: act('more', { optional: true }) }, field('price'),
        { kind: 'click', click: act('tab') }, field('pickup'), { kind: 'click', click: act('delivery', { do: 'choose', value: 'Delivery' }) }, field('delivery')],
};

describe('action steps', () => {
    it('tells the extractor\'s plain clicks from Pro\'s actions', () => {
        expect(isProAction(act('a'))).toBe(false);
        expect(isProAction(act('a', { do: 'click' }))).toBe(false);
        expect(isProAction(act('a', { optional: true }))).toBe(true);
        expect(isProAction(act('a', { do: 'type', value: 'x' }))).toBe(true);
    });

    it('cuts a page recipe into reads and actions, keeping plain clicks in the reads', () => {
        expect(segments(spec).map(s => s.kind === 'read' ? s.spec.steps.map(st => st.kind === 'field' ? st.field.id : `click:${st.click.id}`) : `act:${s.click.id}`)).toEqual([
            ['title'], 'act:more', ['price', 'click:tab', 'pickup'], 'act:delivery', ['delivery'],
        ]);
    });

    it('finds the variables a recipe needs, and fills them from a job\'s context', () => {
        expect(variablesOf(spec)).toEqual(['zip', 'store']);
        expect(missingVariables(spec, { zip: '10001' })).toEqual(['store']);
        expect(fillVariables('{store} store, {zip}', { zip: '10001', store: 'Chelsea' })).toBe('Chelsea store, 10001');
        expect(() => fillVariables('{zip}', {})).toThrow(MissingVariable);
        expect(describeAction(act('a', { do: 'type', value: '{zip}', enter: true }))).toBe('type {zip} then Enter');
        expect(describeAction(act('a', { do: 'choose', index: 0, optional: true }))).toBe('choose #1 (optional)');
    });

    it('says what an action lacks', () => {
        expect(actionProblems(act('z', { do: 'type' }))).toEqual(['Step "z" needs a value to type.']);
        expect(actionProblems(act('c', { do: 'choose' }))).toEqual(['Step "c" needs the text to choose, or which item.']);
        expect(actionProblems({ id: 'k', name: 'k', ways: [], do: 'press', value: 'Escape' })).toEqual([]);
        expect(problems({ ...spec, setup: { steps: [], check: { ways: [], contains: ' ' } } })).toEqual([
            'The setup check needs the text it must contain.', 'The setup check has no element to read.',
        ]);
    });
});

describe('session setup in a version', () => {
    it('gives the setup\'s, dismissals\' and check\'s ways ids, kept across versions', () => {
        let n = 0;
        const v1 = assignWayIds(spec, 1, undefined, () => `w${++n}`) as PageRecipeSpec;
        expect(v1.setup!.steps[1].ways[0]).toMatchObject({ id: expect.any(String), addedIn: 1 });
        expect(v1.setup!.dismiss![0].ways[0].id).toBeDefined();
        expect(v1.setup!.check!.ways[0].id).toBeDefined();
        const v2 = assignWayIds(spec, 2, v1, () => `w${++n}`) as PageRecipeSpec;
        expect(v2.setup!.steps[1].ways[0]).toEqual(v1.setup!.steps[1].ways[0]);
        expect(listWays(v1).map(w => w.owner)).toEqual(expect.arrayContaining(['setup: zip', 'dismiss: consent', 'setup: check', 'more']));
    });

    it('shows a changed setup, and a changed action, in the version diff', () => {
        const version = (s: PageRecipeSpec, n: number): Version => ({ recipeId: 'r', version: n, spec: s, settings: {}, pages: { kind: 'urls', urls: [] }, output: {}, digest: `d${n}`, outputDigest: 'o', origin: 'edited', note: '', author: 'a', createdAt: 0 });
        const next: PageRecipeSpec = {
            ...spec,
            setup: { ...spec.setup!, check: { ...spec.setup!.check!, contains: '{zip}' } },
            steps: spec.steps.map(s => s.kind === 'click' && s.click.id === 'delivery' ? { kind: 'click', click: { ...s.click, value: 'Shipping' } } : s),
        };
        const changes = diffVersions(version(spec, 1), version(next, 2)).changes;
        expect(changes).toEqual(expect.arrayContaining([
            { kind: 'changed', subject: 'session setup', details: ['check: contains Deliver to {zip} → {zip}'] },
            expect.objectContaining({ kind: 'added', subject: expect.stringMatching(/^click/) }),
        ]));
    });
});
