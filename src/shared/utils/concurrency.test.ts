import { describe, it, expect } from 'vitest';
import { defaultConcurrency, tabsHint } from './concurrency';

describe('defaultConcurrency', () => {
    it('fits the computer: fewer pages at once on less memory or fewer cores', () => {
        expect(defaultConcurrency({ deviceMemory: 8, hardwareConcurrency: 10 })).toBe(5);
        expect(defaultConcurrency({ deviceMemory: 4, hardwareConcurrency: 4 })).toBe(2);
        expect(defaultConcurrency({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe(2);
        expect(defaultConcurrency({ deviceMemory: 0.5, hardwareConcurrency: 2 })).toBe(1);
        expect(defaultConcurrency({})).toBe(2);
    });

    it('says what suits this computer, and warns when more are chosen', () => {
        expect(tabsHint(2, 2)).toBe('2 tabs at a time suit this computer (max 5)');
        expect(tabsHint(1, 1)).toBe('1 tab at a time suits this computer (max 5)');
        expect(tabsHint(4, 2)).toBe('2 tabs at a time suit this computer. More may slow it down; the run eases off if it struggles.');
    });
});
