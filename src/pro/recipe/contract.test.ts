import { describe, expect, it } from 'vitest';
import type { PageResult } from '../runner/testPage';
import { checkAgainstContract, contractFromSchema, contractReasons, flattenRecord, resolveContract } from './contract';
import type { Field } from './types';

const field = (name: string, type: Field['type'] = 'text'): Field => ({ id: name, name, type, read: 'text', ways: [], ops: [] });
const page = (values: Record<string, unknown>, error?: string): PageResult => ({
    url: 'https://a.test', clicks: [], ...(error ? { error } : {}),
    fields: Object.entries(values).map(([name, v]) => ({ fieldId: name, name, status: 'ok', raw: v, value: v, cleaned: v, filled: v != null, ok: true })),
});

describe('contracts', () => {
    it('resolves the presets and the bundled sample schema by name', () => {
        expect(resolveContract('retail.listing_item@1')?.label).toBe('Retail listing item');
        const fashion = resolveContract('fashion-product.schema.json')!;
        const type = (n: string) => fashion.fields.find(f => f.name === n)?.type;
        expect(type('images')).toBe('string[]');
        expect(type('product_url')).toBe('url');
        expect(fashion.fields.filter(f => f.required).map(f => f.name)).toEqual(expect.arrayContaining(['brand', 'title', 'product_url']));
        expect(resolveContract('nope.json')).toBeUndefined();
    });

    it('reads a pasted schema, and refuses one with no fields', () => {
        const c = contractFromSchema('{"type":"object","required":["name"],"properties":{"name":{"type":"string"},"price":{"type":"number"}}}', 'custom', 'Mine');
        expect(c.fields).toEqual([{ name: 'name', type: 'string', required: true }, { name: 'price', type: 'number' }]);
        expect(() => contractFromSchema('{"type":"object","properties":{}}', 'x', 'x')).toThrow('No fields');
    });

    it('maps fields by name, checks fill per page, and says what is missing', () => {
        const contract = contractFromSchema('{"type":"object","required":["title","brand"],"properties":{"title":{"type":"string"},"brand":{"type":"string"},"price":{"type":"number"}}}', 'c', 'C');
        const fields = [field('title'), field('price', 'money')];
        const check = checkAgainstContract(contract, fields, [page({ title: 'A', price: '10' }), page({ title: null, price: '12' }), page({}, 'Timed out')]);
        expect(check.mapping).toMatchObject({ title: 'title', price: 'price', brand: null });
        expect(check.pages).toBe(2);
        expect(check.report.coverage).toMatchObject({ title: 0.5, price: 1 });
        expect(contractReasons(check)).toEqual([
            'Contract: no field gives the required "brand".',
            'Contract: "title" is filled on 50% of pages; it needs 95%.',
        ]);
    });

    it('a mapping set by hand wins over the names', () => {
        const contract = contractFromSchema('{"type":"object","required":["brand"],"properties":{"brand":{"type":"string"}}}', 'c', 'C');
        const check = checkAgainstContract(contract, [field('maker')], [page({ maker: 'Northpeak' })], { brand: 'maker' });
        expect(check.report.ok).toBe(true);
        expect(contractReasons(check)).toEqual([]);
    });

    it('offers the retail product schema', () => {
        expect(resolveContract('retail.product@1')?.fields.filter(f => f.required).map(f => f.name)).toEqual(['product_id', 'title']);
    });

    it('with a transform, checks its output by the contract\'s names, nested ones dotted', () => {
        const contract = contractFromSchema('{"type":"object","required":["title","offer.price"],"properties":{"title":{"type":"string"},"offer.price":{"type":"number"},"brand":{"type":"string"}}}', 'c', 'C');
        expect(flattenRecord({ title: 'A', offer: { price: 3 }, tags: ['x'] })).toEqual({ title: 'A', 'offer.price': 3, tags: ['x'] });
        const transform = { jolt: [{ operation: 'shift' as const, spec: { name: 'title', cost: 'offer.price' } }] };
        const done = (record: unknown): PageResult => ({ ...page({ name: 'A', cost: 3 }), record });
        // The fields are named otherwise: only the output counts.
        const check = checkAgainstContract(contract, [field('name'), field('cost')], [done({ title: 'A', offer: { price: 3 } }), done({ title: 'B' }), { ...page({}), recordError: 'bad' }], undefined, transform);
        expect(check.on).toBe('transform');
        expect(check.mapping).toEqual({ title: 'title', 'offer.price': 'offer.price', brand: null });
        expect(check.report.coverage).toMatchObject({ title: 2 / 3, 'offer.price': 1 / 3 });
        expect(contractReasons(check)).toEqual([
            'Contract: "title" is filled on 67% of pages; it needs 95%.',
            'Contract: "offer.price" is filled on 33% of pages; it needs 95%.',
        ]);
        expect(contractReasons(checkAgainstContract(contract, [], [done({ title: 'A' })], undefined, transform)))
            .toContain('Contract: the transform\'s output has no "offer.price", which is required.');
    });
});
