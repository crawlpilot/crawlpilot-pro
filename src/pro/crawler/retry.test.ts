import { describe, expect, it } from 'vitest';
import { classOf } from './classify';
import { backoffMs, decide, DEFAULT_RETRY } from './retry';

const half = () => 0.5;

describe('retry decisions', () => {
    it('back off exponentially with jitter, up to the cap', () => {
        expect(backoffMs(1, DEFAULT_RETRY, () => 0)).toBe(1000);
        expect(backoffMs(1, DEFAULT_RETRY, () => 1)).toBe(2000);
        expect(backoffMs(3, DEFAULT_RETRY, () => 1)).toBe(8000);
        expect(backoffMs(20, DEFAULT_RETRY, () => 1)).toBe(DEFAULT_RETRY.maxDelayMs);
    });

    it('finish on success, on final errors, and on running out of attempts', () => {
        expect(decide(classOf('none'), 1, DEFAULT_RETRY)).toEqual({ action: 'done', outcome: 'success' });
        expect(decide(classOf('not_found'), 1, DEFAULT_RETRY)).toEqual({ action: 'done', outcome: 'failed' });
        expect(decide(classOf('no_recipe'), 1, DEFAULT_RETRY)).toEqual({ action: 'done', outcome: 'dead_letter' });
        expect(decide(classOf('server_error'), DEFAULT_RETRY.maxAttempts, DEFAULT_RETRY)).toEqual({ action: 'done', outcome: 'dead_letter' });
    });

    it('retry proxy-side failures here on another proxy, and site errors on the same one', () => {
        expect(decide(classOf('proxy'), 1, DEFAULT_RETRY, undefined, half)).toEqual({ action: 'retry', waitMs: 1500, switchProxy: true });
        expect(decide(classOf('timeout'), 2, DEFAULT_RETRY, undefined, half)).toEqual({ action: 'retry', waitMs: 3000, switchProxy: true });
        expect(decide(classOf('server_error'), 1, DEFAULT_RETRY, undefined, half)).toEqual({ action: 'retry', waitMs: 1500, switchProxy: false });
    });

    it('put blocked and rate-limited jobs back for the site\'s cooldown, and long waits on the queue', () => {
        expect(decide(classOf('blocked'), 1, DEFAULT_RETRY, 60_000, half)).toEqual({ action: 'defer', delayMs: 60_000 });
        expect(decide(classOf('rate_limited', { retryAfterMs: 90_000 }), 1, DEFAULT_RETRY, 30_000, half)).toEqual({ action: 'defer', delayMs: 90_000 });
        expect(decide(classOf('server_error', { retryAfterMs: 40_000 }), 1, DEFAULT_RETRY, undefined, half)).toEqual({ action: 'defer', delayMs: 40_000 });
        expect(decide(classOf('recipe_store'), 1, DEFAULT_RETRY, undefined, half)).toMatchObject({ action: 'defer' });
    });
});
