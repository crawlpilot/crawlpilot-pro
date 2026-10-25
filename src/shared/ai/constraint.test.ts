import { describe, it, expect } from 'vitest';
import { compileConstraint, relax, DEFAULT_MAX_ITEMS } from './constraint';
import { buildResponseSchema } from './extractPrompt';

describe('compileConstraint', () => {
    it('resolves refs, drops annotations, closes objects and bounds arrays', () => {
        const out = compileConstraint({
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            title: 'Listing',
            type: 'object',
            properties: {
                products: { type: 'array', items: { $ref: '#/$defs/product' } },
                total: { type: ['integer', 'null'], examples: [12] },
            },
            required: ['products', 'missing'],
            $defs: { product: { type: 'object', properties: { title: { type: 'string', format: 'uri', description: 'name' }, price: { type: 'number', default: 0 } } } },
        });
        expect(out).toEqual({
            type: 'object',
            properties: {
                products: {
                    type: 'array', maxItems: DEFAULT_MAX_ITEMS,
                    items: { type: 'object', properties: { title: { type: 'string', description: 'name' }, price: { type: 'number' } }, additionalProperties: false },
                },
                total: { type: 'integer' },
            },
            required: ['products'],
            additionalProperties: false,
        });
    });

    it('caps a larger maxItems and keeps a smaller one', () => {
        expect(compileConstraint({ type: 'array', items: { type: 'string' }, maxItems: 500 }).maxItems).toBe(DEFAULT_MAX_ITEMS);
        expect(compileConstraint({ type: 'array', items: { type: 'string' }, maxItems: 3 }).maxItems).toBe(3);
    });

    it('collapses unions and ends recursive refs', () => {
        expect(compileConstraint({ oneOf: [{ type: 'number' }, { type: 'null' }] })).toEqual({ type: 'number' });
        expect(compileConstraint({ anyOf: [{ type: 'number' }, { type: 'string' }] })).toEqual({ type: 'string' });
        const tree = compileConstraint({ $ref: '#/$defs/node', $defs: { node: { type: 'object', properties: { child: { $ref: '#/$defs/node' } } } } });
        let depth = 0;
        for (let n: any = tree; n?.properties?.child; n = n.properties.child) depth++;
        expect(depth).toBeLessThan(10);
    });

    it('can drop descriptions (for omitResponseConstraintInput)', () => {
        expect(compileConstraint({ type: 'string', description: 'x' }, { descriptions: false })).toEqual({ type: 'string' });
    });

    it('keeps the extraction schema as built, ref pattern included', () => {
        const schema = compileConstraint(buildResponseSchema([{ name: 'price', type: 'string' }]));
        expect(schema.properties.price.properties.ref).toEqual({ type: 'string', pattern: '^(b[0-9]+)?$' });
    });
});

describe('relax', () => {
    const schema = compileConstraint({
        type: 'object',
        properties: {
            ref: { type: 'string', pattern: '^e[0-9]+$' },
            kind: { type: 'string', enum: ['a', 'b'] },
            items: { type: 'array', items: { type: 'object', properties: { x: { type: 'string' } } } },
        },
    });

    it('gives up patterns, then enums, then nested structure, each step including the ones before', () => {
        const p = relax(schema, 0)!;
        expect(p.properties.ref).toEqual({ type: 'string' });
        expect(p.properties.kind.enum).toEqual(['a', 'b']);
        const e = relax(schema, 1)!;
        expect(e.properties.kind).toEqual({ type: 'string' });
        expect(e.properties.ref).toEqual({ type: 'string' });
        const d = relax(schema, 2)!;
        expect(d.properties.items.items).toEqual({ type: 'string' });
        expect(relax(schema, 3)).toBeNull();
    });
});
