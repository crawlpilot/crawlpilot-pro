import { describe, it, expect } from 'vitest';
import { buildPageRecord } from './columnHelpers';

const data = {
    e_title: 'Desk Lamp',
    e_related: {
        __type: 'list',
        items: [{ title: 'Floor Lamp', price: '$59' }, { title: 'Wall Light' }],
        columns: [
            { id: 'title', name: 'Related - Title', elementName: 'Related', type: 'text' },
            { id: 'price', name: 'Related - Price', elementName: 'Related', type: 'price' },
        ],
    },
};
const known = [{ id: 'e_title', name: 'Title', type: 'text' }];

describe('buildPageRecord', () => {
    it('nests a list into one JSON column by default', () => {
        const r = buildPageRecord(data, known);
        expect(r.columns.map(c => c.id)).toEqual(['recordId', 'e_title', 'e_related']);
        expect(JSON.parse(r.item.e_related)).toEqual([{ Title: 'Floor Lamp', Price: '$59' }, { Title: 'Wall Light' }]);
        expect(r.items).toBeUndefined();
    });

    it('makes one row per item, repeating the page fields', () => {
        const r = buildPageRecord(data, known, 'rows');
        expect(r.items).toHaveLength(2);
        expect(r.items![1]).toMatchObject({ e_title: 'Desk Lamp', title: 'Wall Light', price: null });
        expect(r.columns.map(c => c.id)).toEqual(['recordId', 'e_title', 'title', 'price']);
    });

    it('numbers columns per list element, capped', () => {
        const many = { ...data, e_related: { ...data.e_related, items: Array.from({ length: 15 }, (_, i) => ({ title: `T${i}` })) } };
        const r = buildPageRecord(many, known, 'numbered');
        const ids = r.columns.map(c => c.id).filter(id => id.startsWith('e_related__title_'));
        expect(ids).toHaveLength(10);
        expect(r.item['e_related__title_1']).toBe('T0');
    });
});
