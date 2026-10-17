import { describe, it, expect } from 'vitest';
import { parseSitemapXml, urlPattern, groupByPattern, matchesFilters } from './sitemap';

describe('parseSitemapXml', () => {
    it('reads a urlset with lastmod', () => {
        const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://ex.com/p/1</loc><lastmod>2024-01-01</lastmod></url>
            <url><loc> https://ex.com/p/2 </loc></url></urlset>`;
        expect(parseSitemapXml(xml)).toEqual({ urls: [{ loc: 'https://ex.com/p/1', lastmod: '2024-01-01' }, { loc: 'https://ex.com/p/2', lastmod: undefined }], sitemaps: [] });
    });
    it('reads a sitemap index', () => {
        const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://ex.com/s1.xml.gz</loc></sitemap></sitemapindex>`;
        expect(parseSitemapXml(xml).sitemaps).toEqual(['https://ex.com/s1.xml.gz']);
    });
    it('falls back to text sitemaps', () => {
        expect(parseSitemapXml('https://ex.com/a\nhttps://ex.com/b\n').urls.map(u => u.loc)).toEqual(['https://ex.com/a', 'https://ex.com/b']);
    });
});

describe('urlPattern / groupByPattern', () => {
    it.each([
        ['https://ex.com/products/desk-lamp-123', '/products/*'],
        ['https://ex.com/products/chair', '/products/*'],
        ['https://ex.com/blog/2024/05/my-post', '/blog/*/*/*'],
        ['https://ex.com/about', '/about'],
        ['https://ex.com/12345', '/*'],
        ['https://ex.com/', '/'],
        ['https://ex.com/dp/B0ABC12345', '/dp/*'],
    ])('%s → %s', (u, p) => expect(urlPattern(u)).toBe(p));

    it('groups and sorts by size', () => {
        const g = groupByPattern(['https://ex.com/p/1', 'https://ex.com/p/2', 'https://ex.com/about']);
        expect(g.map(x => [x.pattern, x.urls.length])).toEqual([['/p/*', 2], ['/about', 1]]);
    });
});

describe('matchesFilters', () => {
    it('includes and excludes with globs over path or full URL', () => {
        expect(matchesFilters('https://ex.com/products/a', '/products/*', '')).toBe(true);
        expect(matchesFilters('https://ex.com/blog/a', '/products/*', '')).toBe(false);
        expect(matchesFilters('https://ex.com/products/a?color=red', '', '*color=*')).toBe(false);
        expect(matchesFilters('https://ex.com/x', '', '')).toBe(true);
    });
});
