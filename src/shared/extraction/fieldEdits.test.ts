import { describe, it, expect } from 'vitest';
import { dropField, fieldFill, joinFields, renameField } from './fieldEdits';

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
