import { describe, expect, it } from 'vitest';
import { PageBaselines } from './baseline';
import { classOf } from './classify';
import { SiteGovernor, type SitePolicy } from './governor';

describe('page baselines', () => {
    it('calls a page with no data a soft block only when it is much shorter than the site\'s good pages', () => {
        const b = new PageBaselines({ minSamples: 3 });
        b.good('shop|product|page', 3000);
        b.good('shop|product|page', 3200);
        expect(b.softBlock('shop|product|page', 100)).toBeUndefined(); // Not enough good pages yet.
        b.good('shop|product|page', 2800);
        expect(b.softBlock('shop|product|page', 100)).toMatchObject({ typical: expect.any(Number) });
        expect(b.softBlock('shop|product|page', 100)!.share).toBeLessThan(0.05);
        // A page of usual length with no data is a recipe that no longer fits, not a block.
        expect(b.softBlock('shop|product|page', 2900)).toBeUndefined();
        expect(b.softBlock('other|product|page', 100)).toBeUndefined();
    });

    it('keeps a bounded number of sites', () => {
        const b = new PageBaselines({ minSamples: 1, maxKeys: 2 });
        for (const k of ['a', 'b', 'c']) b.good(k, 1000);
        expect(b.softBlock('a', 10)).toBeUndefined();
        expect(b.softBlock('c', 10)).toBeDefined();
    });
});

describe('a waiting room', () => {
    it('cools the site down without slowing it for good, and says whose room it is', () => {
        const policy: SitePolicy = { minDelayMs: 1000, maxDelayMs: 60_000, concurrency: 1, cooldownBaseMs: 30_000, cooldownMaxMs: 600_000, blockAfter: 3 };
        const events: { state: string; vendor?: string; reason: string }[] = [];
        const g = new SiteGovernor(() => policy, e => events.push(e), () => 0);
        g.reserve('shop.test');
        g.done('shop.test', classOf('waiting_room', { blockSignal: 'status 200 + redirected to the Queue-it waiting room', block: { vendor: 'Queue-it', kind: 'queue', confidence: 'high', signals: [] } }));
        expect(g.stateOf('shop.test')).toMatchObject({ state: 'cooldown', cooldownUntil: 30_000, delayMs: 1000, consecutiveBlocks: 0 });
        expect(events[0]).toMatchObject({ state: 'cooldown', vendor: 'Queue-it', reason: expect.stringContaining('waiting room') });
    });
});
