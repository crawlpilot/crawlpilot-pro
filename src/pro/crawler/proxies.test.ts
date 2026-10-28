import { describe, expect, it } from 'vitest';
import { ProxyPool } from './proxies';

const list = [
    { id: 'p1', server: 'http://p1:8080', country: 'DE' },
    { id: 'p2', server: 'http://p2:8080', country: 'DE' },
    { id: 'p3', server: 'http://p3:8080', country: 'FR' },
];

describe('proxy pool', () => {
    it('keeps a host on one proxy, in its country, and spreads hosts over the least used', () => {
        const pool = new ProxyPool(list);
        expect(pool.pick('a.test', 'DE')?.id).toBe('p1');
        expect(pool.pick('a.test', 'DE')?.id).toBe('p1');
        expect(pool.pick('b.test', 'DE')?.id).toBe('p2');
        expect(pool.pick('c.test', 'FR')?.id).toBe('p3');
    });

    it('sets a proxy aside after failures at its end, and moves the host; a block never does', () => {
        let t = 0;
        const pool = new ProxyPool(list, { downMs: 1000, failuresToDown: 2 }, () => t);
        pool.pick('a.test', 'DE');
        expect(pool.report('p1', 'blocked')).toBe(false);
        expect(pool.report('p1', 'captcha')).toBe(false);
        expect(pool.pick('a.test', 'DE')?.id).toBe('p1');
        expect(pool.report('p1', 'timeout')).toBe(false);
        expect(pool.report('p1', 'connection')).toBe(true);
        expect(pool.pick('a.test', 'DE')?.id).toBe('p2');
        expect(pool.report('p2', 'proxy_auth')).toBe(true);
        expect(pool.pick('a.test', 'DE')).toBeUndefined();
        t = 1000;
        expect(pool.pick('a.test', 'DE')?.id).toBe('p2');
    });

    it('skips proxies a job already failed on', () => {
        const pool = new ProxyPool(list);
        expect(pool.pick('a.test', 'DE', new Set(['p1']))?.id).toBe('p2');
    });
});
