import { describe, expect, it } from 'vitest';
import { keepFromBase } from './repick';
import type { PageRecipeSpec } from './types';

const sel = (selector: string) => ({ kind: 'selector' as const, selector });
const base: PageRecipeSpec = {
    kind: 'page',
    setup: { steps: [{ id: 's1', name: 'Open', ways: [sel('#open')] }], check: { ways: [sel('#loc')], contains: '{zip}' } },
    steps: [
        { kind: 'field', field: { id: 'f1', name: 'price', type: 'money', required: true, read: 'text', ops: [{ op: 'trim' }],
            ways: [{ kind: 'markup', source: 'meta', key: 'product:price:amount' }, sel('.price-old')] } },
        { kind: 'click', click: { id: 'c1', name: 'Tiles', do: 'choose', forEach: { values: ['Pickup', 'Delivery'] }, ways: [sel('.tile-old')] } },
        { kind: 'field', field: { id: 'f2', name: 'gone', type: 'text', read: 'text', ops: [], ways: [sel('.gone')] } },
    ],
};

describe('a recipe picked again', () => {
    it('keeps what Pro added to the fields and steps picked again, and the setup; takes the new selectors', () => {
        const picked: PageRecipeSpec = { kind: 'page', steps: [
            { kind: 'field', field: { id: 'f1', name: 'price', type: 'text', read: 'text', ops: [], ways: [sel('.price-new')] } },
            { kind: 'click', click: { id: 'c1', name: 'Tiles', ways: [sel('.tile-new')] } },
            { kind: 'field', field: { id: 'f3', name: 'span', type: 'text', read: 'text', ops: [], ways: [sel('.new')] } },
        ] };
        const out = keepFromBase(picked, base);
        expect(out.setup).toEqual(base.setup);
        expect(out.steps[0]).toEqual({ kind: 'field', field: { id: 'f1', name: 'price', type: 'money', required: true, read: 'text', ops: [{ op: 'trim' }],
            ways: [{ kind: 'markup', source: 'meta', key: 'product:price:amount' }, sel('.price-new')] } });
        expect(out.steps[1]).toEqual({ kind: 'click', click: { id: 'c1', name: 'Tiles', do: 'choose', forEach: { values: ['Pickup', 'Delivery'] }, ways: [sel('.tile-new')] } });
        // New in this pick: as picked. Dropped by it: gone.
        expect(out.steps[2]).toEqual(picked.steps[2]);
        expect(out.steps).toHaveLength(3);
    });

    it('is the pick itself for a new recipe', () => {
        const picked: PageRecipeSpec = { kind: 'page', steps: [] };
        expect(keepFromBase(picked, undefined)).toBe(picked);
    });
});
