import { describe, it, expect } from 'vitest';
import { hashString } from './hash';

describe('hashString', () => {
    it('is deterministic for the same input', () => {
        expect(hashString('hello world')).toBe(hashString('hello world'));
    });

    it('differs for different input', () => {
        expect(hashString('hello')).not.toBe(hashString('world'));
    });

    it('handles empty strings', () => {
        expect(hashString('')).toBe(0);
    });

    it('returns a 32-bit signed integer', () => {
        const longString = 'x'.repeat(10000);
        const result = hashString(longString);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(-2147483648);
        expect(result).toBeLessThanOrEqual(2147483647);
    });
});
