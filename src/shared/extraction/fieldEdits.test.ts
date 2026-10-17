import { describe, it, expect } from 'vitest';
import { dropField, fieldFill, joinFields, renameField, splitField } from './fieldEdits';

const data = {
    columns: [
        { id: 'price', name: 'Price', type: 'price', reader: { chain: ['.price'], attr: 'text' } },
        { id: 'price_2', name: 'Price 2', type: 'price', reader: { chain: ['.sp .amount'], attr: 'text', alternates: [{ chain: ['.x'] }] } },
        { id: 'title', name: 'Title', type: 'text' },
    ],
    items: [
        { price: '$5', title: 'A' },
        { price_2: '$7', title: 'B' },
        { title: 'C' },
    ],
};

describe('field edits', () => {
    it('joins a variant field into another: one column, reader falls back, rows coalesced', () => {
        const r = joinFields(data, 'price', 'price_2');
        expect(r.columns.map(c => c.id)).toEqual(['price', 'title']);
        expect(r.columns[0].reader).toEqual({
            chain: ['.price'], attr: 'text',
            alternates: [{ chain: ['.sp .amount'], attr: 'text' }, { chain: ['.x'] }],
        });
        expect(r.items).toEqual([{ price: '$5', title: 'A' }, { price: '$7', title: 'B' }, { title: 'C' }]);
    });

    it('drops and renames', () => {
        expect(dropField(data, 'title').items[0]).toEqual({ price: '$5' });
        expect(renameField(data, 'title', '  Name ').columns[2].name).toBe('Name');
        expect(renameField(data, 'title', ' ').columns[2].name).toBe('Title');
    });

    it('measures fill', () => {
        expect(fieldFill(data, 'title')).toBe(1);
        expect(fieldFill(data, 'price')).toBeCloseTo(1 / 3);
    });
});

describe('splitField', () => {
    it('makes one field per kind of value, each reader keeping only its kind', () => {
        const mixed = {
            columns: [{ id: 'meta', name: 'Meta', type: 'text', reader: { chain: ['.m'], attr: 'text' } }],
            items: [{ meta: '$5.00' }, { meta: 'Free shipping' }, { meta: '$7.50' }],
        };
        const r = splitField(mixed, 'meta');
        expect(r.columns.map(c => [c.id, c.name, c.type, (c.reader as any).onlyShape])).toEqual([
            ['meta_price', 'Meta (price)', 'price', 'price'],
            ['meta_text', 'Meta (text)', 'text', 'text'],
        ]);
        expect(r.items).toEqual([{ meta_price: '$5.00' }, { meta_text: 'Free shipping' }, { meta_price: '$7.50' }]);
        expect(splitField(r, 'meta_price')).toBe(r);
    });
});
