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
    ])('%s → %s', (v, shape) => expect(shapeOf(v)).toBe(shape));
});
