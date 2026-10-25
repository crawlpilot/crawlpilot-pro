import { describe, it, expect } from 'vitest';
import { parseSchemaInput, SCHEMA_PRESETS } from './schemaIntake';
import { buildResponseSchema, buildExtractPrompt, buildListPrompt, buildListSchema, parseListOutput, parseModelOutput, isGrounded } from './extractPrompt';

/** What a field means, without the extras the plan adds (label, enum, many). */
const core = (f: { name: string; type: string; description?: string; required?: boolean }) => ({ name: f.name, type: f.type, description: f.description, required: !!f.required });

describe('parseSchemaInput', () => {
    it('reads field lines with descriptions and infers url/image', () => {
        const r = parseSchemaInput('- Title: the heading\nprice = selling price\nimage\nproduct url: link');
        expect(r.source).toBe('lines');
        expect(r.fields.map(core)).toEqual([
            { name: 'title', description: 'the heading', type: 'string', required: false },
            { name: 'price', description: 'selling price', type: 'string', required: false },
            { name: 'image', description: undefined, type: 'image', required: false },
            { name: 'product_url', description: 'link', type: 'url', required: false },
        ]);
    });
    it('reads a JSON Schema', () => {
        const r = parseSchemaInput(JSON.stringify({ type: 'object', required: ['title'], properties: { title: { type: 'string', description: 'Name' }, rating: { type: ['number', 'null'] }, link: { type: 'string', format: 'uri' } } }));
        expect(r.source).toBe('json-schema');
        expect(r.fields.map(core)).toEqual([
            { name: 'title', description: 'Name', type: 'string', required: true },
            { name: 'rating', description: undefined, type: 'number', required: false },
            { name: 'link', description: undefined, type: 'url', required: false },
        ]);
    });
    it('reads an example object', () => {
        const r = parseSchemaInput('{"title":"Lamp","price":24.99,"count":3,"photo":"https://x.com/a.jpg"}');
        expect(r.source).toBe('example');
        expect(r.fields.map(f => [f.name, f.type])).toEqual([['title', 'string'], ['price', 'number'], ['count', 'integer'], ['photo', 'image']]);
    });
    it('presets parse', () => {
        Object.values(SCHEMA_PRESETS).forEach(p => {
            const r = parseSchemaInput(p.text);
            expect(r.error).toBeUndefined();
            expect(r.fields.length + r.lists.reduce((n, l) => n + l.fields.length, 0)).toBeGreaterThan(3);
        });
        expect(parseSchemaInput(SCHEMA_PRESETS.listing.text).lists[0]).toMatchObject({ name: 'products', description: 'every product shown in the results' });
    });
    it('splits entity lists from single answers: lines, JSON Schema, example', () => {
        const lines = parseSchemaInput('category: page heading\nproducts[]:\n  title: name\n  image\nsellers[]: name, rating\nfooter_note');
        expect(lines.fields.map(f => f.name)).toEqual(['category', 'footer_note']);
        expect(lines.lists.map(l => ({ name: l.name, fields: l.fields.map(core) }))).toEqual([
            { name: 'products', fields: [{ name: 'title', description: 'name', type: 'string', required: false }, { name: 'image', description: undefined, type: 'image', required: false }] },
            { name: 'sellers', fields: [{ name: 'name', description: undefined, type: 'string', required: false }, { name: 'rating', description: undefined, type: 'string', required: false }] },
        ]);
        const schema = parseSchemaInput(JSON.stringify({
            type: 'object',
            properties: { total: { type: 'integer' }, products: { type: 'array', description: 'results', items: { $ref: '#/$defs/p' } } },
            $defs: { p: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, url: { type: 'string', format: 'uri' } } } },
        }));
        expect(schema.fields.map(core)).toEqual([{ name: 'total', type: 'integer', required: false, description: undefined }]);
        expect(schema.lists.map(l => ({ name: l.name, description: l.description, fields: l.fields.map(core) }))).toEqual([{ name: 'products', description: 'results', fields: [{ name: 'title', type: 'string', required: true, description: undefined }, { name: 'url', type: 'url', required: false, description: undefined }] }]);
        const example = parseSchemaInput('[{"title": "Lamp", "price": 9.5}]');
        expect(example.lists.map(l => ({ name: l.name, fields: l.fields.map(core) }))).toEqual([{ name: 'items', fields: [{ name: 'title', type: 'string', description: 'e.g. Lamp', required: false }, { name: 'price', type: 'number', description: undefined, required: false }] }]);
    });
    it('reports errors', () => {
        expect(parseSchemaInput('').error).toBeTruthy();
        expect(parseSchemaInput('{bad json').error).toBeTruthy();
    });
});

describe('prompt and output', () => {
    const fields = parseSchemaInput('title\nprice').fields;
    it('builds a strict schema', () => {
        const s: any = buildResponseSchema(fields);
        expect(s.required).toEqual(['title', 'price']);
        expect(s.additionalProperties).toBe(false);
        expect(s.properties.price.required).toEqual(['value', 'ref']);
    });
    it('fences the page as data and lists fields and user instructions', () => {
        const p = buildExtractPrompt('# Lamp [b1]', fields, 'prices in USD');
        expect(p).toContain('<page>\n# Lamp [b1]\n</page>');
        expect(p).toContain('- price');
        expect(p).toContain('prices in USD');
    });
    it('parses clean and fenced output; anything else is invalid', () => {
        expect(parseModelOutput('{"title":{"value":"Lamp","ref":"b1"},"price":{"value":"$9","ref":"[b4]"}}', fields))
            .toEqual({ title: { value: 'Lamp', ref: 'b1' }, price: { value: '$9', ref: 'b4' } });
        expect(parseModelOutput('```json\n{"title":"Lamp"}\n```', fields).title).toEqual({ value: 'Lamp', ref: '' });
        expect(() => parseModelOutput('nonsense', fields)).toThrow();
    });
    it('lists: one ref per item, bounded, empty items dropped', () => {
        const list = parseSchemaInput('products[]: title, price').lists[0];
        const schema: any = buildListSchema(list, 12);
        expect(schema.properties.items.maxItems).toBe(12);
        expect(schema.properties.items.items.required).toEqual(['ref', 'title', 'price']);
        expect(buildListPrompt('x', list, 12)).toContain('at most 12');
        expect(parseListOutput('{"items":[{"ref":"b3","title":"Lamp","price":"$9"},{"ref":"","title":"","price":""}]}', list))
            .toEqual([{ ref: 'b3', values: { title: 'Lamp', price: '$9' } }]);
    });
});

describe('isGrounded', () => {
    it.each([
        ['$24.99', 'Price: $24.99', true],
        ['desk  lamp', 'Desk Lamp', true],
        ['Desk Lamp by Acme', 'Desk Lamp by', true],
        ['$19.99', 'Price: $24.99', false],
        ['Great lamp for your desk', 'Lamp', false],
        ['', 'x', false],
    ] as const)('%s in %s → %s', (v, t, ok) => expect(isGrounded(v, t)).toBe(ok));
});
