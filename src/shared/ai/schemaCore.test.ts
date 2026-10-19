import { describe, expect, it } from 'vitest';
import { normalizeSchemaInput } from './schemaNormalize';
import { planSchema } from './schemaPlan';
import { assemble, sourcesByPointer, splitMany, validate } from './assemble';
import { parseSchemaInput } from './schemaIntake';

const plan = (input: unknown) => {
    const n = normalizeSchemaInput(typeof input === 'string' ? input : JSON.stringify(input));
    if (!n.schema) throw new Error(n.error);
    return { schema: n.schema, plan: planSchema(n.schema), problems: n.problems };
};

const PRODUCT = {
    type: 'object',
    required: ['title', 'price'],
    properties: {
        title: { type: 'string' },
        price: { type: 'number', description: 'selling price' },
        availability: { enum: ['in_stock', 'out_of_stock'] },
        tags: { type: 'array', items: { type: 'string' } },
        dimensions: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } } },
        image: { type: 'string', format: 'uri' },
        variants: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, price: { type: 'number' } } } },
    },
};

describe('normalising every input form to one JSON Schema', () => {
    it('lines: dotted names nest, `x[]:` with fields is a list, without fields a list of values', () => {
        const { schema } = plan('title\ndimensions.width: in cm\ndimensions.height\ntags[]: the product tags\nproducts[]: name, url');
        expect(schema.properties.dimensions).toEqual({ type: 'object', properties: { width: { type: 'string', description: 'in cm' }, height: { type: 'string' } } });
        expect(schema.properties.tags).toEqual({ type: 'array', items: { type: 'string' }, description: 'the product tags' });
        expect(schema.properties.products.items.properties.url).toEqual({ type: 'string', format: 'uri' });
    });

    it('example: nested objects and arrays keep their shape; list items take keys from the first items', () => {
        const { schema } = plan({ name: 'Lamp', size: { w: 10 }, colors: ['red'], reviews: [{ by: 'A' }, { by: 'B', stars: 4 }] });
        expect(schema.properties.size).toEqual({ type: 'object', properties: { w: { type: 'integer' } } });
        expect(schema.properties.colors).toEqual({ type: 'array', items: { type: 'string', description: 'e.g. red' } });
        expect(Object.keys(schema.properties.reviews.items.properties)).toEqual(['by', 'stars']);
    });

    it('JSON Schema: $refs resolved, unions made one type, enum and format kept, annotations dropped', () => {
        const { schema, problems } = plan({
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: {
                a: { $ref: '#/$defs/money' },
                b: { type: ['string', 'null'], format: 'date', examples: ['2024-01-01'] },
                c: { anyOf: [{ type: 'object', properties: { x: { type: 'string' } } }, { type: 'object', properties: { y: { type: 'string' } } }] },
            },
            $defs: { money: { type: 'object', properties: { amount: { type: 'number' }, currency: { enum: ['USD', 'EUR'] } } } },
        });
        expect(schema.properties.a.properties.currency).toEqual({ type: 'string', enum: ['USD', 'EUR'] });
        expect(schema.properties.b).toEqual({ type: 'string', format: 'date' });
        expect(schema.properties.c.properties).toEqual({ x: { type: 'string' } });
        expect(problems.join()).toMatch(/one of several shapes/);
    });

    it('reports what is read in a simpler way, never dropping it silently', () => {
        const { plan: p, problems } = plan({ type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'object', properties: { c: { type: 'object', properties: { d: { type: 'object', properties: { e: { type: 'string' } } } } } } } } }, grid: { type: 'array', items: { type: 'array', items: { type: 'string' } } } } });
        expect([...problems, ...p.problems].join(' ')).toMatch(/deeper than 4 levels.*|list inside a list/);
        expect(p.single.find(l => l.key === 'grid')?.type).toBe('string');
    });

    it('errors: empty, bad JSON, nothing to extract', () => {
        expect(normalizeSchemaInput('').error).toBeTruthy();
        expect(normalizeSchemaInput('{bad').error).toBeTruthy();
        expect(normalizeSchemaInput('{"type":"object","properties":{}}').error).toBeTruthy();
    });
});

describe('the plan', () => {
    it('splits single answers from entity lists, with flat keys and pointers for nested values', () => {
        const { plan: p } = plan(PRODUCT);
        expect(p.single.map(l => [l.key, l.pointer, l.type, l.kind])).toEqual([
            ['title', '/title', 'string', 'string'],
            ['price', '/price', 'number', 'number'],
            ['availability', '/availability', 'string', 'string'],
            ['tags', '/tags', 'string', 'string'],
            ['dimensions__width', '/dimensions/width', 'number', 'number'],
            ['dimensions__height', '/dimensions/height', 'number', 'number'],
            ['image', '/image', 'string', 'image'],
        ]);
        expect(p.single.find(l => l.key === 'tags')?.many).toBe(true);
        expect(p.single.find(l => l.key === 'availability')?.enum).toEqual(['in_stock', 'out_of_stock']);
        expect(p.lists).toEqual([expect.objectContaining({ key: 'variants', pointer: '/variants' })]);
        expect(p.lists[0].leaves.map(l => [l.key, l.required])).toEqual([['name', true], ['price', false]]);
    });

    it('tells the model about enums, nesting and several values', () => {
        const r = parseSchemaInput(JSON.stringify(PRODUCT));
        expect(r.fields.find(f => f.name === 'availability')?.description).toMatch(/one of: in_stock, out_of_stock/);
        expect(r.fields.find(f => f.name === 'tags')?.description).toMatch(/separated by ' \| '/);
        expect(r.fields.find(f => f.name === 'dimensions__width')?.label).toBe('dimensions.width');
    });

    it('a schema that is itself a list of objects is one list at the root', () => {
        const { plan: p } = plan({ type: 'array', items: { type: 'object', properties: { t: { type: 'string' } } } });
        expect(p.rootList).toBe(true);
        expect(p.lists[0]).toMatchObject({ key: 'items', pointer: '' });
    });
});

describe('assembling, validating, sources', () => {
    const { schema, plan: p } = plan(PRODUCT);
    const single = { title: 'Desk Lamp', price: '$24.99', availability: 'In_Stock', tags: 'office | led | dimmable', dimensions__width: '30', dimensions__height: '', image: 'https://x.com/a.jpg' };
    const lists = { variants: [{ name: 'Black', price: '24.99' }, { name: 'White', price: '' }] };

    it('rebuilds the schema shape: nesting, arrays of values, enum spelling, numbers; empty optional values left out', () => {
        expect(assemble(p, { single, lists })).toEqual({
            title: 'Desk Lamp',
            price: 24.99,
            availability: 'in_stock',
            tags: ['office', 'led', 'dimmable'],
            dimensions: { width: 30 },
            image: 'https://x.com/a.jpg',
            variants: [{ name: 'Black', price: 24.99 }, { name: 'White' }],
        });
    });

    it('a required value not found is null, and the validator says so', () => {
        const data = assemble(p, { single: { ...single, price: '' }, lists });
        expect((data as any).price).toBeNull();
        expect(validate(data, schema)).toEqual([{ pointer: '/price', problem: 'required, not found' }]);
    });

    it('validates type, enum, format and item counts by pointer', () => {
        const bad = { title: 'x', price: 'cheap', availability: 'maybe', image: 'not a url', variants: [{ name: 3 }] };
        expect(validate(bad, schema)).toEqual([
            { pointer: '/price', problem: 'should be a number' },
            { pointer: '/availability', problem: 'not one of in_stock, out_of_stock' },
            { pointer: '/image', problem: 'not a valid URL' },
            { pointer: '/variants/0/name', problem: 'should be a string' },
        ]);
        expect(validate({ xs: [1, 2, 3] }, { type: 'object', properties: { xs: { type: 'array', items: { type: 'number' }, maxItems: 2 } } })).toEqual([{ pointer: '/xs', problem: 'at most 2 items' }]);
    });

    it('sources are keyed by the pointer of each value, list items by index', () => {
        const meta = sourcesByPointer(p, { title: 'b1', dimensions__width: 'b7' }, { variants: [{ name: 'b20' }, { price: 'b31' }] });
        expect(meta).toEqual({ '/title': 'b1', '/dimensions/width': 'b7', '/variants/0/name': 'b20', '/variants/1/price': 'b31' });
    });

    it('splits several values written as a | b, one per line, or a; b', () => {
        expect(splitMany('a | b')).toEqual(['a', 'b']);
        expect(splitMany('a\nb')).toEqual(['a', 'b']);
        expect(splitMany('a; b')).toEqual(['a', 'b']);
        expect(splitMany(['a', ''])).toEqual(['a']);
    });
});
