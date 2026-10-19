import { describe, it, expect } from 'vitest';
import { defaultConcurrency } from './concurrency';

describe('defaultConcurrency', () => {
    it('fits the computer: fewer pages at once on less memory or fewer cores', () => {
        expect(defaultConcurrency({ deviceMemory: 8, hardwareConcurrency: 10 })).toBe(5);
        expect(defaultConcurrency({ deviceMemory: 4, hardwareConcurrency: 4 })).toBe(2);
        expect(defaultConcurrency({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe(2);
        expect(defaultConcurrency({ deviceMemory: 0.5, hardwareConcurrency: 2 })).toBe(1);
        expect(defaultConcurrency({})).toBe(2);
    });
});
