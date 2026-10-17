import { describe, it, expect } from 'vitest';
import { parseRobots, checkRobots } from './robots';
import { recommend } from './recommend';
import type { ReconReport } from './types';

const ROBOTS = `
# comment
User-agent: Googlebot
Disallow: /private

User-agent: *
Disallow: /search
Allow: /search/about
Disallow: /*.pdf$
Disallow: /cart?
Crawl-delay: 2

Sitemap: https://ex.com/sitemap.xml
Sitemap: https://ex.com/sitemap-products.xml
`;

describe('robots', () => {
    const r = parseRobots(ROBOTS);
    it('collects sitemaps and groups', () => {
        expect(r.sitemaps).toHaveLength(2);
        expect(r.groups).toHaveLength(2);
    });
    it('longest match wins; Allow beats Disallow', () => {
        expect(checkRobots(r, '/search?q=x').allowed).toBe(false);
        expect(checkRobots(r, '/search/about').allowed).toBe(true);
        expect(checkRobots(r, '/products/1').allowed).toBe(true);
    });
    it('supports * and $', () => {
        expect(checkRobots(r, '/docs/a.pdf').allowed).toBe(false);
        expect(checkRobots(r, '/docs/a.pdf?x=1').allowed).toBe(true);
        expect(checkRobots(r, '/cart?id=1').allowed).toBe(false);
    });
    it('uses the named group for a matching agent', () => {
        expect(checkRobots(r, '/search', 'Googlebot/2.1').allowed).toBe(true);
        expect(checkRobots(r, '/private', 'Googlebot/2.1').allowed).toBe(false);
    });
    it('reports the crawl delay and the deciding rule', () => {
        const d = checkRobots(r, '/search');
        expect(d.rule).toBe('Disallow: /search');
        expect(d.crawlDelay).toBe(2);
    });
    it('empty Disallow allows everything', () => {
        expect(checkRobots(parseRobots('User-agent: *\nDisallow:'), '/x').allowed).toBe(true);
    });
});

function report(over: Partial<ReconReport>): ReconReport {
    return {
        url: 'https://ex.com/p/1', title: 'X',
        check: { verdict: 'ok', reason: '', botManagers: [] },
        rendering: { frameworks: [], spaShell: false, liveTextLength: 5000, servedTextLength: 4800, servedStatus: 200, needsJs: false },
        embedded: [], hreflangCount: 0, feeds: [],
        pagination: { loadMore: false, nextButton: false },
        ...over,
    };
}

describe('recommend', () => {
    it('prefers embedded JSON', () => {
        const rec = recommend(report({ embedded: [{ kind: 'json-ld', label: 'JSON-LD Product', size: 900, types: ['Product'] }] }));
        expect(rec.approach).toBe('http-json');
    });
    it('ignores JSON-LD that only describes the website', () => {
        const rec = recommend(report({ embedded: [{ kind: 'json-ld', label: 'JSON-LD WebSite', size: 200, types: ['WebSite'] }] }));
        expect(rec.approach).toBe('http-html');
    });
    it('says browser when content needs JavaScript', () => {
        expect(recommend(report({ rendering: { frameworks: ['React'], spaShell: true, liveTextLength: 5000, servedTextLength: 40, servedStatus: 200, needsJs: true } })).approach).toBe('browser');
    });
    it('flags blocked pages and robots/vendor notes', () => {
        const rec = recommend(report({
            check: { verdict: 'challenge', reason: 'hCaptcha challenge', botManagers: [{ id: 'datadome', name: 'DataDome', evidence: 'cookie datadome' }] },
            robots: { found: true, status: 200, allowed: false, rule: 'Disallow: /p', sitemaps: [] },
        }));
        expect(rec.approach).toBe('blocked');
        expect(rec.notes.join(' ')).toMatch(/DataDome/);
        expect(rec.notes.join(' ')).toMatch(/robots\.txt disallows/);
    });
});
