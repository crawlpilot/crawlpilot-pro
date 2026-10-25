import { describe, it, expect } from 'vitest';
import { stepStats } from './stepStats';

describe('stepStats', () => {
    it('counts each step over the pages: how it went, the share it worked on, the pages it failed on', () => {
        const step = (id: string, action: 'extract' | 'click', status: any) => ({ id, name: id, action, status });
        const stats = stepStats([
            { url: 'a', steps: [step('price', 'extract', 'data'), step('open', 'click', 'skipped'), step('specs', 'extract', 'ok')] },
            { url: 'b', steps: [step('price', 'extract', 'healed'), step('open', 'click', 'clicked'), step('specs', 'extract', 'not-found')] },
            { url: 'c', steps: [step('price', 'extract', 'ok'), step('open', 'click', 'no-effect'), step('specs', 'extract', 'empty')] },
        ]);
        const by = Object.fromEntries(stats.map(s => [s.name, s]));
        expect(by.price).toMatchObject({ pages: 3, fill: 1, failing: [], counts: { data: 1, healed: 1, ok: 1 } });
        expect(by.open.fill).toBeCloseTo(2 / 3);
        expect(by.open.failing).toEqual(['c']);
        expect(by.specs).toMatchObject({ fill: 1 / 3, failing: ['b', 'c'] });
    });
});
