import { describe, it, expect } from 'vitest';
import { shapeOf } from './shape';

describe('shapeOf', () => {
    it.each([
        ['$24.99', 'price'],
        ['List: $325.99', 'price'],
        ['From £20 – £35', 'price'],
        ['$20.96 delivery Mon, Nov 2', 'text'],
        ['Save $5 with coupon on this item', 'text'],
        ['(1.3K)', 'count'],
        ['(39)', 'count'],
        ['39', 'number'],
        ['4.4 out of 5 stars', 'rating'],
        ['Top Brand', 'text'],
        // Phone numbers, however written; IDs, thousands, barcodes, dates and model codes aren't.
        ['080 4370 1234', 'phone'],
        ['098455 12345', 'phone'],
        ['09845512345', 'phone'],
        ['+91 98455 12345', 'phone'],
        ['1800-258-5656', 'phone'],
        ['(555) 123-4567', 'phone'],
        ['+44 20 7946 0958', 'phone'],
        ['12574753', 'number'],
        ['10 000 000', 'number'],
        ['1,234,567', 'number'],
        ['012345678905', 'number'],
        ['978-0-306-40615-7', 'text'],
        ['2024-10-19', 'date'],
        ['2626-20', 'text'],
    ])('%s → %s', (v, shape) => expect(shapeOf(v)).toBe(shape));
});
