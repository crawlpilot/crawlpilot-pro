import { describe, expect, it } from 'vitest';
import { readRun } from '../crawler/recipeRun';
import { carryOver } from '../recipe/fromPublic';
import { readiness } from '../recipe/ready';
import type { Field, PageRecipeSpec, Way } from '../recipe/types';
import { pageTestRequest, readPageResult } from './testPage';
import { identityMismatch, resolveWays } from './ways';

const field = (over: Partial<Field>): Field => ({ id: 'f', name: 'f', type: 'text', read: 'text', ways: [], ops: [], ...over });
const sel = (selector: string, over: Partial<Extract<Way, { kind: 'selector' }>> = {}): Way => ({ kind: 'selector', selector, ...over });

describe('resolveWays', () => {
    it('takes the first way whose own cleanup gives something, Atlas-style (regex group 0, trimmed)', () => {
        const f = field({
            ways: [
                sel('.a', { ops: [{ op: 'regex', pattern: '\\$\\d+', flags: 'is', group: 0 }] }),
                sel('.b', { ops: [{ op: 'regex', pattern: '(?<=Sold by ).*', flags: 'is', group: 0 }, { op: 'trim' }] }),
            ],
        });
        expect(resolveWays(f, [{ values: ['no price'] }, { values: ['Sold by  Acme '] }])).toEqual({ raw: 'Acme', won: 1 });
        expect(resolveWays(f, [{ values: ['$12'] }, { values: [] }])).toEqual({ raw: '$12', won: 0 });
        expect(resolveWays(f, [{ skipped: true, values: [] }, { values: [] }])).toEqual({ raw: null, won: -1 });
    });

    it('picks the first match, the first filled once cleaned, or all of them; drops bidi marks first', () => {
        const digits = [{ op: 'regex' as const, pattern: '\\d+', group: 0 }];
        expect(resolveWays(field({ ways: [sel('li', { ops: digits })] }), [{ values: ['none', 'a 7'] }]).raw).toBeNull();
        expect(resolveWays(field({ ways: [sel('li', { pick: 'firstFilled', ops: digits })] }), [{ values: ['none', 'a 7'] }]).raw).toBe('7');
        expect(resolveWays(field({ ways: [sel('li', { pick: 'all', ops: [{ op: 'join', sep: ' > ' }] })] }), [{ values: ['Home', '\u200EBaby'] }]).raw).toBe('Home > Baby');
        expect(resolveWays(field({ ways: [sel('li', { pick: 'all' })] }), [{ values: ['a', 'b'] }]).raw).toEqual(['a', 'b']);
    });

    it('makes an object of name/value pairs', () => {
        expect(resolveWays(field({ ways: [sel('tr', { read: 'pairs' })] }), [{ values: [], pairs: [['Weight', '2 lb'], ['', 'x']] }]).raw).toEqual({ Weight: '2 lb' });
    });
});

describe('identityMismatch', () => {
    const identity = { field: 'SKU', url: ['(?<=dp/)\\w*', '(?<=product/)\\w+'] };

    it('compares the id in the URL with the field, case aside', () => {
        expect(identityMismatch(identity, 'https://a.test/x/dp/B00ABC?th=1', 'b00abc')).toBeUndefined();
        expect(identityMismatch(identity, 'https://a.test/x/dp/B00ABC', 'B00XYZ')).toEqual({ expected: 'B00ABC', found: 'B00XYZ' });
    });

    it('is no mismatch when there is nothing to compare', () => {
        expect(identityMismatch(identity, 'https://a.test/search', 'B00XYZ')).toBeUndefined();
        expect(identityMismatch(identity, 'https://a.test/dp/B00ABC', '')).toBeUndefined();
    });
});

const spec: PageRecipeSpec = {
    kind: 'page',
    steps: [
        { kind: 'field', field: field({ id: 't', name: 'TITLE', ways: [sel('h1')] }) },
        { kind: 'field', field: field({ id: 's', name: 'SKU', ways: [sel('#asin', { read: 'attr', attr: 'value', id: 'SKU-0' }), sel('#sku', { id: 'SKU-1' })] }) },
    ],
    rules: [{ name: '404', status: 'not_found', when: { kind: 'regex', pattern: 'Page Not Found', op: 'gt', value: 0 } }],
    identity: { field: 'SKU', url: ['(?<=dp/)\\w+'] },
};

describe('a page recipe read way by way', () => {
    it('sends the ways of the fields that need them, and the page rules', () => {
        const req = pageTestRequest(spec, {}, 'https://a.test/dp/B1');
        expect(req.elements[0]).not.toHaveProperty('ways');
        expect(req.elements[1].ways).toEqual([{ selector: '#asin', read: 'attr', attr: 'value' }, { selector: '#sku', read: 'text' }]);
        expect(req.config.pageRules).toEqual(spec.rules);
    });

    it('reads a field from its ways, and finds another product', () => {
        const steps = [{ id: 's', name: 'SKU', action: 'extract' as const, status: 'ok' as const, hits: [{ values: [] }, { values: ['B2'] }] }];
        const result = readPageResult(spec, 'https://a.test/dp/B1', { t: 'Lamp' }, steps);
        expect(result.fields.find(f => f.name === 'SKU')).toMatchObject({ value: 'B2', way: 1, status: 'ok' });
        expect(result.mismatch).toEqual({ expected: 'B1', found: 'B2' });
        expect(readiness([result, result, result]).reasons).toContain('3 pages are another product than their URL names.');
    });

    it('in the crawler: a page rule is a verdict, and ways read one by one report their usage', () => {
        const ruled = readRun(spec, 'https://a.test/dp/B1', { item: {}, steps: [], ways: [], rule: { name: '404', status: 'not_found' } });
        expect(ruled.verdict).toEqual({ errorClass: 'not_found', message: 'Page rule "404" held' });
        expect(readRun(spec, 'u', { item: {}, steps: [], ways: [], rule: { name: 'captcha', status: 'blocked' } }).verdict?.errorClass).toBe('blocked');

        const read = readRun(spec, 'https://a.test/dp/B1', {
            item: { t: 'Lamp' }, ways: [],
            steps: [{ id: 's', name: 'SKU', action: 'extract', status: 'ok', hits: [{ skipped: true, values: [] }, { values: ['B1'] }] }],
        });
        expect(read.verdict).toBeUndefined();
        expect(read.attributes).toEqual({ TITLE: 'Lamp', SKU: 'B1' });
        expect(read.ways).toEqual([
            { field: 'SKU', wayId: 'SKU-0', tried: false, matched: false, won: false },
            { field: 'SKU', wayId: 'SKU-1', tried: true, matched: true, won: true },
        ]);
    });

    it('keeps its rules, identity and ways through an edit in the Page Extractor that left them alone', () => {
        const edited: PageRecipeSpec = { kind: 'page', steps: spec.steps.map(s => s.kind === 'field' ? { kind: 'field', field: { ...s.field, ways: s.field.ways.map(w => w.kind === 'selector' ? { kind: 'selector', selector: w.selector } : w) } } : s) };
        const kept = carryOver(spec, edited);
        expect(kept.rules).toEqual(spec.rules);
        expect(kept.identity).toEqual(spec.identity);
        expect(kept.steps[1]).toEqual(spec.steps[1]);
        const changed = carryOver(spec, { ...edited, steps: [edited.steps[0], { kind: 'field', field: field({ id: 's', name: 'SKU', ways: [sel('#new')] }) }] });
        expect(changed.steps[1]).toEqual({ kind: 'field', field: field({ id: 's', name: 'SKU', ways: [sel('#new')] }) });
    });
});
