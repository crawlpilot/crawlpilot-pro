import { describe, expect, it } from 'vitest';
import { checkField } from '../runner/check';
import { readPageResult } from '../runner/readPage';
import { problems, renameField, setChecks } from './editSpec';
import type { Field, PageRecipeSpec } from './types';
import { compareHolds, describeCheck, failsCheck } from './valueChecks';

const field = (over: Partial<Field>): Field => ({ id: 'f', name: 'f', type: 'text', read: 'text', ways: [{ kind: 'selector', selector: '.f' }], ops: [], ...over });

describe('value checks', () => {
    it('a pattern, matched or not, on text and on each item of a list', () => {
        expect(failsCheck({ kind: 'pattern', pattern: '^LX-\\d+$' }, 'LX-2041', 'LX-2041')).toBeNull();
        expect(failsCheck({ kind: 'pattern', pattern: '^LX-\\d+$' }, 'SKU 1', 'SKU 1')).toBe('not like /^LX-\\d+$/');
        expect(failsCheck({ kind: 'pattern', pattern: 'sold out', flags: 'i', not: true }, 'Sold Out', 'Sold Out')).toBe('like /sold out/');
        expect(failsCheck({ kind: 'pattern', pattern: '^\\d' }, ['1a', 'b'], ['1a', 'b'])).toBe('not like /^\\d/');
    });

    it('a range on the typed number, a list of allowed values, a length', () => {
        expect(failsCheck({ kind: 'range', min: 1, max: 1000 }, 79, '$79.00')).toBeNull();
        expect(failsCheck({ kind: 'range', min: 1 }, 0, '$0.00')).toBe('below 1');
        expect(failsCheck({ kind: 'range', max: 1000 }, 1200, '1,200')).toBe('above 1000');
        expect(failsCheck({ kind: 'range', min: 1 }, 'n/a', 'n/a')).toBe('not a number to compare');
        expect(failsCheck({ kind: 'oneOf', values: ['In stock', 'Out of stock', ''] }, ' in  STOCK ', ' in  STOCK ')).toBeNull();
        expect(failsCheck({ kind: 'oneOf', values: ['In stock', 'Out of stock'] }, 'Maybe', 'Maybe')).toBe('"Maybe" is not one of In stock, Out of stock');
        expect(failsCheck({ kind: 'length', min: 3 }, 'ab', 'ab')).toBe('2 characters, fewer than 3');
        expect(failsCheck({ kind: 'length', max: 2 }, ['a', 'b', 'c'], ['a', 'b', 'c'])).toBe('3 items, more than 2');
    });

    it('compares as numbers when both are, else as text', () => {
        expect(compareHolds('lte', 59, 79)).toBe(true);
        expect(compareHolds('lt', '10', '9')).toBe(false);
        expect(compareHolds('lt', '2024-01-02', '2024-01-10')).toBe(true);
        expect(compareHolds('ne', 'a', 'a')).toBe(false);
    });

    it('reads as a sentence', () => {
        expect(describeCheck({ kind: 'range', min: 1, max: 1000 })).toBe('between 1 and 1000');
        expect(describeCheck({ kind: 'compare', op: 'lte', field: 'list_price' })).toBe('at most list_price');
        expect(describeCheck({ kind: 'oneOf', values: [] })).toBe('one of (none yet)');
    });
});

describe('a field with checks, on a page', () => {
    it('a failed check is the field\'s problem; an empty value is left to "required"', () => {
        const price = field({ name: 'price', type: 'money', checks: [{ kind: 'range', min: 1 }] });
        expect(checkField(price, '$0.00')).toMatchObject({ ok: false, problem: 'below 1', value: 0 });
        expect(checkField(price, '$79.00')).toMatchObject({ ok: true, value: 79 });
        expect(checkField(price, '')).toMatchObject({ ok: true, filled: false });
        // Not of its type: that is the problem, before any check.
        expect(checkField(price, 'call us')).toMatchObject({ ok: false, problem: 'not a money' });
    });

    it('a comparison with another field runs once the page is read, and only when both are filled', () => {
        const spec: PageRecipeSpec = { kind: 'page', steps: [
            { kind: 'field', field: field({ id: 's', name: 'sale', type: 'money', checks: [{ kind: 'compare', op: 'lte', field: 'list' }] }) },
            { kind: 'field', field: field({ id: 'l', name: 'list', type: 'money' }) },
        ] };
        const sale = (s: string, l: string) => readPageResult(spec, 'u', { s, l }).fields[0];
        expect(sale('$59', '$79')).toMatchObject({ ok: true });
        expect(sale('$99', '$79')).toMatchObject({ ok: false, problem: 'not at most list (99 vs 79)' });
        expect(sale('$99', '')).toMatchObject({ ok: true });
    });
});

describe('editing checks', () => {
    const spec: PageRecipeSpec = { kind: 'page', steps: [
        { kind: 'field', field: field({ id: 's', name: 'sale', checks: [{ kind: 'compare', op: 'lte', field: 'list' }] }) },
        { kind: 'field', field: field({ id: 'l', name: 'list' }) },
    ], identity: { field: 'list', url: ['\\d+'] } };

    it('a renamed field takes its comparisons and the identity check with it', () => {
        const renamed = renameField(spec, 'l', 'list_price');
        expect(renamed.steps[0]).toMatchObject({ field: { checks: [{ kind: 'compare', field: 'list_price' }] } });
        expect(renamed.identity?.field).toBe('list_price');
        expect(problems(renamed)).toEqual([]);
    });

    it('says what a check lacks; no checks drops the key', () => {
        const bad = setChecks(spec, 'l', [{ kind: 'pattern', pattern: '(' }, { kind: 'range', min: 5, max: 1 }, { kind: 'oneOf', values: [' '] }, { kind: 'compare', op: 'eq', field: 'nope' }]);
        expect(problems(bad)).toEqual([
            '"list": /(/ is not a valid regex.', '"list": a range check\'s minimum is above its maximum.',
            '"list": a "one of" check has no values.', '"list": compares with "nope", which is not a field.',
        ]);
        expect(setChecks(spec, 's', []).steps[0]).not.toHaveProperty('field.checks');
    });
});
