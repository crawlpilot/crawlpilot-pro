import { describe, expect, it } from 'vitest';
import { passed } from '../db/tests';
import { readiness } from '../recipe/ready';
import type { PageRecipeSpec } from '../recipe/types';
import { pageOutcome } from './outcome';
import type { PageResult } from './readPage';

const read = (url: string, ok = true): PageResult => ({
    url, clicks: [], fields: [{ fieldId: 't', name: 'title', status: 'ok', raw: 'x', value: 'x', cleaned: 'x', filled: true, ok, ...(ok ? {} : { problem: 'not a money' }) }],
});
const ruled = (url: string, name = '404'): PageResult => ({ url, clicks: [], fields: [], rule: { name, status: 'not_found' } });
const spec: PageRecipeSpec = {
    kind: 'page', steps: [],
    rules: [{ name: '404', status: 'not_found', when: { kind: 'regex', pattern: 'Not Found', op: 'gt', value: 0 } }],
};
const version = { spec, output: {} };

describe('pageOutcome', () => {
    it('says what each page is', () => {
        expect(pageOutcome(read('a'))).toMatchObject({ kind: 'read', ok: true, title: '1 of 1 fields found' });
        expect(pageOutcome(read('a', false))).toMatchObject({ kind: 'read', ok: false, detail: '1 with a problem.' });
        expect(pageOutcome({ url: 'a', clicks: [], fields: [], error: 'Timed out' })).toMatchObject({ kind: 'error', ok: false, detail: 'Timed out' });
        expect(pageOutcome(ruled('a'))).toMatchObject({ kind: 'rule', ok: false, title: 'Page rule "404" held: Not found' });
        expect(pageOutcome({ ...read('a'), mismatch: { expected: 'B1', found: 'B2' } })).toMatchObject({ kind: 'mismatch', ok: false, detail: 'The URL names B1; the page has B2.' });
    });

    it('a sample kept for a rule passes when that rule holds, and not otherwise', () => {
        expect(pageOutcome(ruled('a'), '404')).toMatchObject({ kind: 'rule', ok: true });
        expect(pageOutcome(ruled('a', 'captcha'), '404')).toMatchObject({ kind: 'rule', ok: false, detail: 'This sample should hit "404". No field was read.' });
        expect(pageOutcome(read('a'), '404')).toMatchObject({ kind: 'missed-rule', ok: false, title: 'Page rule "404" did not hold' });
    });
});

describe('passed', () => {
    it('a page a rule held on fails, unless its sample expects that rule', () => {
        expect(passed([read('a'), ruled('b')])).toBe(false);
        expect(passed([read('a'), ruled('b')], [{ url: 'b', expectRule: '404' }])).toBe(true);
        expect(passed([read('a'), read('b')], [{ url: 'b', expectRule: '404' }])).toBe(false);
    });
});

describe('readiness with error-page samples', () => {
    it('counts them apart: they pass by their rule, and 3 other pages are read', () => {
        const samples = [{ url: 'x', expectRule: '404' }];
        expect(readiness([read('a'), read('b'), read('c'), ruled('x')], version, samples)).toEqual({ ready: true, reasons: [] });
        expect(readiness([read('a'), read('b'), ruled('x')], version, samples).reasons).toEqual(['Tested on 2 pages; it needs 3.']);
        expect(readiness([read('a'), read('b'), read('c'), read('x')], version, samples).reasons).toEqual(['x: Page rule "404" did not hold.']);
    });

    it('an unexpected rule says how to keep the page for it; a rule gone from the recipe is named', () => {
        expect(readiness([read('a'), read('b'), read('c'), ruled('x')], version).reasons)
            .toEqual(['Page rule "404" held on 1 page: not a page to read. If it is kept to test the rule, mark it so.']);
        expect(readiness([read('a'), read('b'), read('c'), ruled('x', 'old')], version, [{ url: 'x', expectRule: 'old' }]).reasons)
            .toEqual(['A sample should hit page rule "old", which the recipe no longer has.']);
    });
});
