import { describe, expect, it } from 'vitest';
import { parseRobots, RobotsCache } from './robots';

const TEXT = `
User-agent: *
Disallow: /checkout
Disallow: /*?sort=
Allow: /checkout/help

User-agent: OtherBot
User-agent: CrawlPilotBot
Disallow: /private
Disallow: /*.pdf$
`;

describe('robots.txt', () => {
    it('uses our group when it names us, the longest rule winning and Allow on a tie', () => {
        const ours = parseRobots(TEXT, 'CrawlPilotBot/1.0');
        expect(ours.allowed('https://s.test/private/x')).toBe(false);
        expect(ours.allowed('https://s.test/file.pdf')).toBe(false);
        expect(ours.allowed('https://s.test/file.pdf?x=1')).toBe(true);
        expect(ours.allowed('https://s.test/checkout')).toBe(true);

        const anyone = parseRobots(TEXT, 'SomeBot');
        expect(anyone.allowed('https://s.test/checkout/pay')).toBe(false);
        expect(anyone.allowed('https://s.test/checkout/help')).toBe(true);
        expect(anyone.allowed('https://s.test/shirts?sort=price')).toBe(false);
        expect(anyone.allowed('https://s.test/shirts')).toBe(true);
        expect(parseRobots('User-agent: *\nDisallow:', 'x').allowed('https://s.test/a')).toBe(true);
    });

    it('caches per origin; no file allows, and an unreadable one allows and is tried again sooner', async () => {
        let t = 0;
        const fetched: string[] = [];
        const replies: Record<string, { status: number; text: string }> = {
            'https://a.test/robots.txt': { status: 200, text: 'User-agent: *\nDisallow: /x' },
            'https://b.test/robots.txt': { status: 404, text: '' },
            'https://c.test/robots.txt': { status: 503, text: '' },
        };
        const cache = new RobotsCache('CrawlPilotBot', async url => { fetched.push(url); return replies[url]; }, 3_600_000, 300_000, () => t);
        expect(await cache.allowed('https://a.test/x/1')).toBe(false);
        expect(await cache.allowed('https://a.test/y')).toBe(true);
        expect(await cache.allowed('https://b.test/x')).toBe(true);
        expect(await cache.allowed('https://c.test/x')).toBe(true);
        t = 300_001;
        await cache.allowed('https://a.test/y');
        await cache.allowed('https://c.test/x');
        expect(fetched).toEqual(['https://a.test/robots.txt', 'https://b.test/robots.txt', 'https://c.test/robots.txt', 'https://c.test/robots.txt']);
    });
});
