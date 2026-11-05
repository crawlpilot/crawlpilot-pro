import { describe, expect, it } from 'vitest';
import { RETAIL_PRODUCT } from './contract';
import { joltProblems, joltTransform } from './jolt';
import { compileMapping, compilesTo, mappingOutput, mappingProblems, mappingSources, proposeMapping, valueAt, type MappingRow } from './mapping';

/** A product record as a page with page data gives it: a specs object (name → value) and image rows. */
const record = {
    TITLE: 'Expert Grill 4-Burner Gas Grill',
    SKU: '17070020028',
    PRICE: '$194.00',
    RATING: '4.2',
    REVIEWS: '6968',
    SPECS: { Brand: 'Expert Grill', 'Fuel Type': 'Propane', 'Number of Burners': '4', 'Assembled Product Weight': '62.5 lb' },
    IMAGES: [{ id: 'a', url: 'https://i5.walmartimages.com/a.jpg' }, { id: 'b', url: 'https://i5.walmartimages.com/b.jpg' }],
    BULLETS: ['Steel lid', 'Side shelves'],
    FLAGS: 'true',
};
const fields = Object.keys(record);
const out = (rows: MappingRow[]) => mappingOutput(rows, record).value!;

describe('mapping rows', () => {
    it('lists each field, each key of an object field and each column of a table field', () => {
        const labels = mappingSources(fields, record).map(s => s.label);
        expect(labels).toEqual(expect.arrayContaining(['TITLE', 'SPECS', 'SPECS › Fuel Type', 'IMAGES › url (each row)', 'IMAGES › id (each row)']));
        expect(mappingSources(fields, record).find(s => s.label === 'IMAGES › url (each row)')?.value).toEqual(['https://i5.walmartimages.com/a.jpg', 'https://i5.walmartimages.com/b.jpg']);
    });

    it('compile to JOLT that renames, nests, reads keys and columns, and writes fixed text', () => {
        const rows: MappingRow[] = [
            { output: 'title', from: { kind: 'field', field: 'TITLE' } },
            { output: 'offer.price', from: { kind: 'field', field: 'PRICE' } },
            { output: 'fuel', from: { kind: 'key', field: 'SPECS', key: 'Fuel Type' } },
            { output: 'images', from: { kind: 'column', field: 'IMAGES', column: 'url' } },
            { output: 'specs', from: { kind: 'field', field: 'SPECS' } },
            { output: 'source', from: { kind: 'text', text: 'walmart' } },
        ];
        const chain = compileMapping(rows);
        expect(joltProblems(chain)).toEqual([]);
        // A field read as it is and inside: `@` sends the whole of it.
        expect(chain[0].spec).toMatchObject({ SPECS: { '@': 'specs', 'Fuel Type': 'fuel' }, IMAGES: { '*': { url: 'images[]' } }, '#walmart': 'source' });
        expect(joltTransform(structuredClone(record), chain)).toEqual({
            title: record.TITLE, offer: { price: '$194.00' }, fuel: 'Propane', specs: record.SPECS, source: 'walmart',
            images: ['https://i5.walmartimages.com/a.jpg', 'https://i5.walmartimages.com/b.jpg'],
        });
    });

    it('convert, join, split, count, pick an item, make a list or one value, and fill a default', () => {
        const value = out([
            { output: 'rating', from: { kind: 'field', field: 'RATING' }, how: 'number' },
            { output: 'reviews', from: { kind: 'field', field: 'REVIEWS' }, how: 'integer' },
            { output: 'burners', from: { kind: 'key', field: 'SPECS', key: 'Number of Burners' }, how: 'integer' },
            { output: 'flag', from: { kind: 'field', field: 'FLAGS' }, how: 'boolean' },
            { output: 'bullets', from: { kind: 'field', field: 'BULLETS' }, how: 'join', sep: ' | ' },
            { output: 'image_count', from: { kind: 'column', field: 'IMAGES', column: 'url' }, how: 'count' },
            { output: 'last_image', from: { kind: 'column', field: 'IMAGES', column: 'id' }, how: 'last' },
            { output: 'weight', from: { kind: 'key', field: 'SPECS', key: 'Assembled Product Weight' }, how: 'split', sep: ' ' },
            { output: 'brand', from: { kind: 'key', field: 'SPECS', key: 'Brand' }, how: 'upper' },
            { output: 'titles', from: { kind: 'field', field: 'TITLE' }, how: 'list' },
            { output: 'missing', from: { kind: 'field', field: 'NOPE' }, how: 'number', default: 'n/a' },
        ]);
        expect(value).toEqual({
            rating: 4.2, reviews: 6968, burners: 4, flag: true, bullets: 'Steel lid | Side shelves', image_count: 2, last_image: 'b',
            weight: ['62.5', 'lb'], brand: 'EXPERT GRILL', titles: [record.TITLE], missing: 'n/a',
        });
    });

    it('leave out what the page does not have: a conversion does not write null for it', () => {
        expect(out([{ output: 'x.rating', from: { kind: 'field', field: 'NOPE' }, how: 'number' }, { output: 'title', from: { kind: 'field', field: 'TITLE' } }]))
            .toEqual({ title: record.TITLE });
    });

    it('name what cannot compile', () => {
        expect(mappingProblems([
            { output: '', from: { kind: 'field', field: 'TITLE' } },
            { output: 'a[0]', from: { kind: 'field', field: 'TITLE' } },
            { output: 'a', from: { kind: 'key', field: 'SPECS', key: '@type' } },
            { output: 'b', from: { kind: 'field', field: 'TITLE' }, how: 'join' },
            { output: 'b', from: { kind: 'field', field: 'SKU' } },
        ])).toEqual([
            'Row 1: give it an output name.',
            'Row 2: "a[0]" can only use letters, digits, _, - and spaces, with dots to nest.',
            'Row 3: the key "@type" has a character JOLT reads as a pattern; write this one in JOLT.',
            'Row 4: give a separator to join on (no quotes).',
            'Row 5: "b" is written by another row too.',
        ]);
    });

    it('know when the JOLT was edited by hand', () => {
        const rows: MappingRow[] = [{ output: 'title', from: { kind: 'field', field: 'TITLE' } }];
        expect(compilesTo(rows, compileMapping(rows))).toBe(true);
        expect(compilesTo(rows, [{ operation: 'shift', spec: { TITLE: 'name' } }])).toBe(false);
    });
});

describe('proposals from the retail product schema', () => {
    it('pair fields, spec keys and table columns by name and value, with the conversion each needs', () => {
        const rows = proposeMapping(RETAIL_PRODUCT, fields, record);
        const by = Object.fromEntries(rows.map(r => [r.output, r]));
        expect(by.title.from).toEqual({ kind: 'field', field: 'TITLE' });
        expect(by.product_id.from).toEqual({ kind: 'field', field: 'SKU' });
        expect(by.price).toMatchObject({ from: { kind: 'field', field: 'PRICE' } });
        expect(by.price.how).toBeUndefined(); // "$194.00": money stays text; the contract reads it.
        expect(by.rating).toMatchObject({ from: { kind: 'field', field: 'RATING' }, how: 'number' });
        expect(by.reviews_count).toMatchObject({ from: { kind: 'field', field: 'REVIEWS' }, how: 'integer' });
        expect(by.brand.from).toEqual({ kind: 'key', field: 'SPECS', key: 'Brand' });
        expect(by.images.from).toEqual({ kind: 'column', field: 'IMAGES', column: 'url' });
        expect(mappingProblems(rows)).toEqual([]);
        expect(valueAt(out(rows), 'rating')).toBe(4.2);
    });

    it('without a tested page, by names alone', () => {
        const rows = proposeMapping(RETAIL_PRODUCT, ['PRODUCT_TITLE', 'IS_PRICE', 'UPC', 'ABOUT_ITEM', 'COLOR']);
        expect(rows.map(r => `${r.output} ← ${r.from.kind === 'field' ? r.from.field : ''}`)).toEqual([
            'title ← PRODUCT_TITLE', 'price ← IS_PRICE', 'upc ← UPC', 'features ← ABOUT_ITEM',
        ]);
    });
});
