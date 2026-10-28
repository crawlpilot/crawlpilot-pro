import { describe, expect, it } from 'vitest';
import { classOf } from './classify';
import { SiteGovernor, type SitePolicy } from './governor';

const policy: SitePolicy = { minDelayMs: 1000, maxDelayMs: 16_000, concurrency: 2, cooldownBaseMs: 60_000, cooldownMaxMs: 600_000, blockAfter: 3 };

function setup() {
    let t = 0;
    const events: { state: string; reason: string }[] = [];
    const g = new SiteGovernor(() => policy, e => events.push(e), () => t);
    return { g, events, at: (ms: number) => { t = ms; } };
}

describe('site governor', () => {
    it('spaces requests out and caps how many run at once', () => {
        const { g } = setup();
        expect(g.reserve('a.test')).toEqual({ waitMs: 0 });
        expect(g.reserve('a.test')).toEqual({ waitMs: 1000 });
        expect(g.reserve('a.test')).toMatchObject({ reason: 'busy' });
        expect(g.reserve('b.test')).toEqual({ waitMs: 0 });
    });

    it('cools a site down on 429 for Retry-After, then lets one request probe, and recovers on success', () => {
        const { g, events, at } = setup();
        g.reserve('a.test');
        g.done('a.test', classOf('rate_limited', { retryAfterMs: 30_000 }));
        expect(g.stateOf('a.test')).toMatchObject({ state: 'cooldown', delayMs: 2000 });
        expect(g.reserve('a.test')).toEqual({ deferMs: 30_000, reason: 'cooldown' });
        at(30_000);
        expect(g.reserve('a.test')).toMatchObject({ waitMs: expect.any(Number) });
        expect(g.reserve('a.test')).toMatchObject({ reason: 'busy' });
        g.done('a.test', classOf('none'));
        expect(g.stateOf('a.test')).toMatchObject({ state: 'ok', delayMs: 1800 });
        expect(events.map(e => e.state)).toEqual(['cooldown', 'ok']);
    });

    it('backs off longer for each block in a row, and marks the site blocked after three', () => {
        const { g, events, at } = setup();
        const block = classOf('blocked', { blockSignal: 'status 403' });
        g.reserve('a.test'); g.done('a.test', block);
        expect(g.stateOf('a.test')).toMatchObject({ state: 'cooldown', cooldownUntil: 60_000, consecutiveBlocks: 1 });
        at(60_000); g.reserve('a.test'); g.done('a.test', classOf('captcha'));
        expect(g.stateOf('a.test')).toMatchObject({ cooldownUntil: 180_000, consecutiveBlocks: 2 });
        at(180_000); g.reserve('a.test'); g.done('a.test', block);
        expect(g.stateOf('a.test')).toMatchObject({ state: 'blocked', cooldownUntil: 780_000, delayMs: 8000 });
        expect(events.map(e => [e.state, e.reason])).toEqual([['cooldown', 'blocked: status 403'], ['cooldown', 'captcha'], ['blocked', 'blocked: status 403']]);
        at(780_000); g.reserve('a.test'); g.done('a.test', classOf('none'));
        expect(g.stateOf('a.test')).toMatchObject({ state: 'ok', consecutiveBlocks: 0 });
    });

    it('slows down on 5xx and ignores failures that are not the site\'s', () => {
        const { g } = setup();
        g.reserve('a.test'); g.done('a.test', classOf('server_error'));
        expect(g.stateOf('a.test').delayMs).toBe(1500);
        g.reserve('a.test'); g.done('a.test', classOf('proxy'));
        expect(g.stateOf('a.test')).toMatchObject({ state: 'ok', delayMs: 1500, inFlight: 0 });
    });
});
