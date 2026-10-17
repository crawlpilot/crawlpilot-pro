import { describe, it, expect } from 'vitest';
import { ListingRunTracker, rowKey, stopReasonLabel } from './runStats';

describe('ListingRunTracker', () => {
    it('drops rows repeated across pages and counts them per page', () => {
        const t = new ListingRunTracker();
        expect(t.add(1, [{ title: 'A', price: '1' }, { title: 'B', price: '2' }])).toHaveLength(2);
        const kept = t.add(2, [{ price: '2', title: 'B' }, { title: 'C', price: '3' }]);
        expect(kept).toEqual([{ title: 'C', price: '3' }]);
        expect(t.duplicates).toBe(1);
        expect(t.pageStats).toEqual([
            { page: 1, rows: 2, duplicates: 0 },
            { page: 2, rows: 1, duplicates: 1 },
        ]);
    });

    it('dedupes by a key column when given', () => {
        const t = new ListingRunTracker('url');
        t.add(1, [{ url: '/p/1', price: '10' }]);
        expect(t.add(2, [{ url: '/p/1', price: '9' }])).toHaveLength(0);
    });

    it('accumulates batches for the same page', () => {
        const t = new ListingRunTracker();
        t.add(1, [{ a: 1 }]);
        t.add(1, [{ a: 2 }]);
        expect(t.pageStats).toEqual([{ page: 1, rows: 2, duplicates: 0 }]);
    });
});

describe('rowKey / stopReasonLabel', () => {
    it('ignores internal fields and key order', () => {
        expect(rowKey({ a: 1, b: 2, _id: 9 })).toBe(rowKey({ b: 2, a: 1, _id: 3 }));
    });
    it('labels known reasons and humanises unknown ones', () => {
        expect(stopReasonLabel('max_pages_reached')).toBe('Reached the page limit');
        expect(stopReasonLabel('some_new_reason')).toBe('some new reason');
    });
});
