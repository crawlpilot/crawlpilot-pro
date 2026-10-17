import { describe, it, expect } from 'vitest';
import { parseSchemaInput, SCHEMA_PRESETS } from './schemaIntake';
import { buildResponseSchema, buildExtractPrompt, parseModelOutput, isGrounded } from './extractPrompt';

describe('parseSchemaInput', () => {
    it('reads field lines with descriptions and infers url/image', () => {
        const r = parseSchemaInput('- Title: the heading\nprice = selling price\nimage\nproduct url: link');
        expect(r.source).toBe('lines');
        expect(r.fields).toEqual([
            { name: 'title', description: 'the heading', type: 'string' },
            { name: 'price', description: 'selling price', type: 'string' },
            { name: 'image', description: undefined, type: 'image' },
            { name: 'product_url', description: 'link', type: 'url' },
        ]);
    });
    it('reads a JSON Schema', () => {
        const r = parseSchemaInput(JSON.stringify({ type: 'object', required: ['title'], properties: { title: { type: 'string', description: 'Name' }, rating: { type: ['number', 'null'] }, link: { type: 'string', format: 'uri' } } }));
        expect(r.source).toBe('json-schema');
        expect(r.fields).toEqual([
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
        Object.values(SCHEMA_PRESETS).forEach(p => expect(parseSchemaInput(p.text).fields.length).toBeGreaterThan(3));
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
    it('lists fields in the prompt', () => {
        expect(buildExtractPrompt('[e1] Lamp', fields)).toContain('- price');
    });
    it('parses clean, fenced and prose-wrapped output', () => {
        expect(parseModelOutput('{"title":{"value":"Lamp","ref":"e1"},"price":{"value":"$9","ref":"[e4]"}}', fields))
            .toEqual({ title: { value: 'Lamp', ref: 'e1' }, price: { value: '$9', ref: 'e4' } });
        expect(parseModelOutput('Sure!\n```json\n{"title":"Lamp"}\n```', fields).title).toEqual({ value: 'Lamp', ref: '' });
        expect(parseModelOutput('nonsense', fields).price).toEqual({ value: '', ref: '' });
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
