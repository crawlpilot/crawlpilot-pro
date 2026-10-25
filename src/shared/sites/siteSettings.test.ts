import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('../storage', () => ({
    storage: {
        get: async (k: string) => store.data[k],
        set: async (k: string, v: unknown) => { store.data[k] = JSON.parse(JSON.stringify(v)); },
    },
}));
import { learnCareful, setSiteSettings, siteOf, siteRun, siteSettings } from './siteSettings';

beforeEach(() => { store.data = {}; });

describe('site settings', () => {
    it('a site is its host without www; a run uses the pace\'s values unless set', () => {
        expect(siteOf('https://www.Shop.test/a?b=1')).toBe('shop.test');
        expect(siteOf('nonsense')).toBe('');
        expect(siteRun(undefined)).toEqual({ pace: 'normal', delayMs: 1000, tabs: 3, pageWaitMs: 10_000, onWall: 'pause' });
        expect(siteRun({ pace: 'careful' })).toMatchObject({ delayMs: 4000, tabs: 1 });
        expect(siteRun({ pace: 'fast', tabs: 2, pageWaitMs: 20_000, onWall: 'skip' })).toEqual({ pace: 'fast', delayMs: 250, tabs: 2, pageWaitMs: 20_000, onWall: 'skip' });
    });

    it('a rate limit makes a site Careful by itself, until the user sets its speed', async () => {
        expect(await learnCareful('shop.test', 'HTTP 429')).toBe(true);
        expect(await siteSettings('shop.test')).toMatchObject({ pace: 'careful', learned: { reason: 'HTTP 429' } });
        // The user's choice replaces what was learned, and a later rate limit doesn't override it.
        await setSiteSettings('shop.test', { pace: 'fast' });
        expect(await siteSettings('shop.test')).toEqual({ pace: 'fast' });
        expect(await learnCareful('shop.test', 'HTTP 429')).toBe(false);
        expect((await siteSettings('shop.test'))?.pace).toBe('fast');
        await setSiteSettings('shop.test', null);
        expect(await siteSettings('shop.test')).toBeUndefined();
    });
});
