import { describe, it, expect } from 'vitest';
import { applyDerive, splitFields } from './split';
import { inferFields, readRow } from './index';
import { collectAtoms, labelValue, withAtomCache } from '../atoms';
import type { Field } from './types';

/** A text field holding `values`, one per row. */
function field(values: string[], extra: Partial<Field> = {}): Field {
    const el = document.createElement('span');
    return { key: 'k', attr: 'text', selector: 'span', values: new Map(values.map((v, i) => [i, v])), atoms: [{ el } as any], shape: 'text', order: 0, ...extra };
}

const parts = (values: string[], extra: Partial<Field> = {}) =>
    splitFields([field(values, extra)]).map(f => [f.label ?? (f.derive ? '?' : 'whole'), [...f.values.values()]]);

describe('splitFields: one value, several fields', () => {
    it('reads a rating and a review count out of a sentence, and drops the sentence it explains', () => {
        expect(parts(['4.4 out of 5 Stars. 510 reviews', '4.1 out of 5 Stars. 7 reviews', '3.9 out of 5 Stars. 1,204 reviews'])).toEqual([
            ['Rating', ['4.4', '4.1', '3.9']],
            ['Review Count', ['510', '7', '1,204']],
        ]);
    });

    it('names the parts of "(4.4 / 1949)" by their values: a decimal up to 5, then a whole number', () => {
        expect(parts(['(4.4 / 1949)', '(4.6 / 9582)', '(3.9 / 15)'])).toEqual([['Rating', ['4.4', '4.6', '3.9']], ['Review Count', ['1949', '9582', '15']]]);
    });

    it('takes values after a label marker, codes joined by dashes included', () => {
        expect(parts(['Model# H300MTS', 'Model# 2626-20', 'Model# A76HOS'])).toEqual([['Model', ['H300MTS', '2626-20', 'A76HOS']]]);
        expect(parts(['At Your Store: 16 in stock', 'At Your Store: 289 in stock', 'At Your Store: 3 in stock'])).toEqual([['Stock', ['16', '289', '3']]]);
        expect(parts(['Delivery: Unavailable in Guam', 'Delivery: Free, arrives Mon', 'Delivery: Tomorrow'])).toEqual([['Delivery', ['Unavailable in Guam', 'Free, arrives Mon', 'Tomorrow']]]);
    });

    it('turns a list of label/value pairs into a field per label', () => {
        const specs = parts(['Display Size; 14 inches; RAM; 4 GB', 'Display Size; 15.6 inches; RAM; 8 GB', 'RAM; 16 GB; Display Size; 13 inches'], { many: true });
        expect(specs).toEqual([['Display Size', ['14 inches', '15.6 inches', '13 inches']], ['RAM', ['4 GB', '8 GB', '16 GB']]]);
    });

    it('leaves alone words and numbers that are one value, and titles', () => {
        expect(parts(['Lamp 1', 'Lamp 2', 'Lamp 3'])).toEqual([['whole', ['Lamp 1', 'Lamp 2', 'Lamp 3']]]);
        expect(parts(['Size 10', 'Size 12', 'Size 8'])).toEqual([['whole', ['Size 10', 'Size 12', 'Size 8']]]);
        const h3 = document.createElement('h3');
        expect(splitFields([field(['Laptop model 2 with 8GB RAM', 'Laptop model 3 with 16GB RAM', 'Laptop model 4 with 4GB RAM'], { atoms: [{ el: h3 } as any] })])).toHaveLength(1);
    });

    it('applies the stored part the same way on a later page, in whichever element fits', () => {
        const [rating] = splitFields([field(['4.4 out of 5 Stars. 510 reviews', '4.1 out of 5 Stars. 7 reviews', '3.9 out of 5 Stars. 12 reviews'])]);
        expect(applyDerive('Save with; 4.8 out of 5 Stars. 63 reviews', rating.derive!)).toBe('4.8');
        expect(applyDerive('No reviews yet', rating.derive!)).toBeUndefined();
    });
});

describe('sources a row offers (GS2)', () => {
    it('reads a label when it shows more than the text: an exact count behind "(27.9K)", the words behind "(115)"', () => {
        document.body.innerHTML = '<a id="a" aria-label="27,976 ratings">(27.9K)</a><a id="b" aria-label="115 ratings">(115)</a><a id="c" aria-label="4.5 out of 5 stars, rating details">4.5 out of 5 stars</a><button aria-label="Add to cart">Add</button>';
        const v = (id: string) => labelValue(document.getElementById(id) ?? document.querySelector('button')!, 'aria-label');
        expect([v('a'), v('b'), v('c'), v('x')]).toEqual(['27,976 ratings', '115 ratings', '', '']);
    });

    it('reads item IDs and value attributes, not trackers', () => {
        document.body.innerHTML = `<ul>${[1, 2, 3].map(i => `<li data-product-id="P${i}00" data-csa-c-item-id="amzn1.${i}" data-dca-id="77${i}"><a href="/p/${i}">Lamp ${i}</a><span data-rating="4.${i}">★</span></li>`).join('')}</ul>`;
        const atoms = withAtomCache(() => collectAtoms(document.querySelector('li')!));
        expect(atoms.filter(a => a.attr.startsWith('data-')).map(a => `${a.attr}=${a.value}`)).toEqual(['data-product-id=P100', 'data-rating=4.1']);
        const rows = Array.from(document.querySelectorAll('li'));
        const { columns } = inferFields(rows);
        expect(columns.map(c => c.name)).toEqual(expect.arrayContaining(['Product ID', 'Rating']));
        expect(readRow(rows[2], columns)).toMatchObject({ product_id: 'P300' });
    });
});
