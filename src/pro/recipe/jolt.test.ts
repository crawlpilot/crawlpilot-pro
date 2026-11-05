import { describe, expect, it } from 'vitest';
import { joltProblems, joltTransform, parseJolt, type JoltOperation } from './jolt';

const shift = (spec: unknown): JoltOperation[] => [{ operation: 'shift', spec }];

describe('shift', () => {
    it('JOLT\'s own example: a literal wins over *, & names the key matched, $ writes it', () => {
        const input = { rating: { primary: { value: 3, max: 5 }, quality: { value: 3, max: 7 } } };
        const spec = { rating: { primary: { value: 'Rating', max: 'RatingRange' }, '*': { value: 'SecondaryRatings.&1.Value', max: 'SecondaryRatings.&1.Range', $: 'SecondaryRatings.&.Id' } } };
        expect(joltTransform(input, shift(spec))).toEqual({
            Rating: 3, RatingRange: 5,
            SecondaryRatings: { quality: { Value: 3, Range: 7, Id: 'quality' } },
        });
    });

    it('a record onto a schema: renames, nesting, literals with #, the whole value with @', () => {
        const record = { title: 'Lamp', price: 24.99, currency: 'USD', sku: 'B0X' };
        const spec = { title: 'product.name', price: 'offer.amount', currency: 'offer.currency', sku: ['id', 'product.sku'], '#amazon': 'source', '@': 'raw' };
        expect(joltTransform(record, shift(spec))).toEqual({
            product: { name: 'Lamp', sku: 'B0X' }, offer: { amount: 24.99, currency: 'USD' }, id: 'B0X', source: 'amazon', raw: record,
        });
    });

    it('lists: * over items, [] appends, [#2] keeps each item\'s place, &(1,1) a capture, a|b either key', () => {
        const input = { images: [{ url: 'a.jpg', w: 1 }, { url: 'b.jpg', w: 2 }], spec_color: 'Red', spec_size: 'L', title: 'T' };
        const spec = {
            images: { '*': { url: 'pictures[]', w: 'sized[#2].width' } },
            'spec_*': 'specs.&(0,1)',
            'title|name': 'name',
        };
        expect(joltTransform(input, shift(spec))).toEqual({
            pictures: ['a.jpg', 'b.jpg'], sized: [{ width: 1 }, { width: 2 }], specs: { color: 'Red', size: 'L' }, name: 'T',
        });
    });

    it('two values to one place make a list; @(1,key) names an output by a value; unmatched keys are dropped', () => {
        const input = { a: 1, b: 2, items: [{ id: 'x', v: 10 }, { id: 'y', v: 20 }], other: true };
        const spec = { a: 'both', b: 'both', items: { '*': { v: 'byId.@(1,id)' } } };
        expect(joltTransform(input, shift(spec))).toEqual({ both: [1, 2], byId: { x: 10, y: 20 } });
    });
});

describe('the other operations', () => {
    it('default fills what is missing or null, * for every key; remove drops; cardinality ONE / MANY; sort', () => {
        const chain: JoltOperation[] = [
            { operation: 'default', spec: { currency: 'USD', price: 0, offers: { '*': { seller: 'unknown' } } } },
            { operation: 'remove', spec: { debug: '', offers: { '*': { internal: '' } } } },
            { operation: 'cardinality', spec: { image: 'ONE', tags: 'MANY' } },
            { operation: 'sort' },
        ];
        const out = joltTransform({ price: null, debug: 1, image: ['a', 'b'], tags: 'sale', offers: { o1: { internal: 1 }, o2: { seller: 'Acme' } } }, chain);
        expect(out).toEqual({ currency: 'USD', image: 'a', offers: { o1: { seller: 'unknown' }, o2: { seller: 'Acme' } }, price: 0, tags: ['sale'] });
        expect(Object.keys(out as object)).toEqual(['currency', 'image', 'offers', 'price', 'tags']);
    });

    it('modify: functions on the value or on siblings, overwrite / default / define', () => {
        const input = { first: 'ada', last: 'lovelace', price: '24.990', tags: 'a, b,c', name: null, items: [{ q: '2' }, { q: '3' }] };
        const out = joltTransform(input, [{ operation: 'modify-overwrite-beta', spec: {
            first: '=toUpper',
            full: "=concat(@(1,first),' ',@(1,last))",
            price: '=toDouble',
            tags: "=split(', ?',@(1,tags))",
            count: '=size(@(1,tags))',
            items: { '*': { q: '=toInteger' } },
        } }, { operation: 'modify-default-beta', spec: { name: '=concat(@(1,first),\'!\')', last: 'ignored' } },
        { operation: 'modify-define-beta', spec: { name: 'not set: name is there', added: 'yes' } }]);
        expect(out).toEqual({ first: 'ADA', last: 'lovelace', full: 'ADA lovelace', price: 24.99, tags: ['a', 'b', 'c'], count: 3, name: 'ADA!', items: [{ q: 2 }, { q: 3 }], added: 'yes' });
    });

    it('chains run in order, and the input is not changed', () => {
        const input = { a: 'x' };
        expect(joltTransform(input, [...shift({ a: 'b' }), { operation: 'modify-overwrite-beta', spec: { b: '=toUpper' } }])).toEqual({ b: 'X' });
        expect(input).toEqual({ a: 'x' });
    });
});

describe('specs as written', () => {
    it('one operation or a list, as JSON text; problems named', () => {
        expect(parseJolt('{"operation":"shift","spec":{"a":"b"}}')).toEqual([{ operation: 'shift', spec: { a: 'b' } }]);
        expect(joltProblems('[{"operation":"shift"')).toEqual([expect.stringMatching(/^Not JSON/)]);
        expect(joltProblems([{ operation: 'shiftr', spec: {} }, { operation: 'shift' }, { operation: 'modify-overwrite-beta', spec: { a: '=nope' } }])).toEqual([
            expect.stringContaining('Operation 1: "shiftr" is not an operation'),
            'Operation 2 (shift): its spec must be an object.',
            'Operation 3: =nope is not a function here.',
        ]);
    });
});

describe('a recipe\'s transform', () => {
    it('reads the page\'s fields by name into the schema; a failing chain says why, and the crawler writes both', async () => {
        const { readPageResult } = await import('../runner/readPage');
        const { readRun } = await import('../crawler/recipeRun');
        const { setTransform, problems } = await import('./editSpec');
        const field = (id: string, name: string, type: 'text' | 'money' = 'text') => ({ kind: 'field' as const, field: { id, name, type, read: 'text', ways: [{ kind: 'selector' as const, selector: `.${id}` }], ops: [] } });
        const base = { kind: 'page' as const, steps: [field('t', 'title'), field('p', 'price', 'money')] };
        const spec = setTransform(base, [{ operation: 'shift', spec: { title: 'product.name', price: 'offer.amount', '#USD': 'offer.currency' } }]);
        const page = readPageResult(spec, 'u', { t: 'Lamp', p: '$24.99' });
        expect(page.record).toEqual({ product: { name: 'Lamp' }, offer: { amount: 24.99, currency: 'USD' } });
        expect(readRun(spec, 'u', { item: { t: 'Lamp', p: '$24.99' }, steps: [], ways: [] }).record).toEqual(page.record);

        const broken = setTransform(base, [{ operation: 'modify-overwrite-beta', spec: { title: '=nope' } }]);
        expect(readPageResult(broken, 'u', { t: 'Lamp' })).toMatchObject({ recordError: '=nope is not a function here.' });
        expect(problems(broken)).toContain('Transform: Operation 1: =nope is not a function here.');
        expect(setTransform(spec, undefined)).toEqual(base);
        expect(readPageResult(base, 'u', { t: 'Lamp' })).not.toHaveProperty('record');
    });
});
