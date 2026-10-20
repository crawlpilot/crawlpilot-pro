import { describe, expect, it } from 'vitest';
import { pageAddresses, urlPages } from './urlPages';

const pages = (current: string, next: string, n = 4) => {
    const p = urlPages(current, next);
    return p ? pageAddresses(p, n) : null;
};

describe('numbered pages by address', () => {
    it('a page number in the query, with or without one on page 1', () => {
        expect(pages('https://shop.test/s?q=lamp&page=1', '/s?q=lamp&page=2')).toEqual([
            'https://shop.test/s?q=lamp&page=1', 'https://shop.test/s?q=lamp&page=2', 'https://shop.test/s?q=lamp&page=3', 'https://shop.test/s?q=lamp&page=4',
        ]);
        expect(pages('https://shop.test/s?q=lamp', 'https://shop.test/s?q=lamp&page=2', 3)).toEqual([
            'https://shop.test/s?q=lamp', 'https://shop.test/s?q=lamp&page=2', 'https://shop.test/s?q=lamp&page=3',
        ]);
    });

    it('an offset: grows by the page size; page 1 without one starts at 0', () => {
        expect(pages('https://jobs.test/list?start=0', '/list?start=25', 3)).toEqual([
            'https://jobs.test/list?start=0', 'https://jobs.test/list?start=25', 'https://jobs.test/list?start=50',
        ]);
        expect(pages('https://jobs.test/list', '/list?offset=24', 3)).toEqual([
            'https://jobs.test/list', 'https://jobs.test/list?offset=24', 'https://jobs.test/list?offset=48',
        ]);
    });

    it('a number in the path, or a numbered tail added to it', () => {
        expect(pages('https://blog.test/news/page/2/', '/news/page/3/', 3)).toEqual([
            'https://blog.test/news/page/2/', 'https://blog.test/news/page/3/', 'https://blog.test/news/page/4/',
        ]);
        expect(pages('https://shop.test/lamps-p1.html', '/lamps-p2.html', 3)).toEqual([
            'https://shop.test/lamps-p1.html', 'https://shop.test/lamps-p2.html', 'https://shop.test/lamps-p3.html',
        ]);
        expect(pages('https://blog.test/news', '/news/page/2', 3)).toEqual([
            'https://blog.test/news', 'https://blog.test/news/page/2', 'https://blog.test/news/page/3',
        ]);
    });

    it('other parts of the address stay as they were (encoded values, fragments of a query)', () => {
        expect(pages('https://shop.test/s?q=a%26b&page=1', '/s?q=a%26b&page=2', 2)).toEqual(['https://shop.test/s?q=a%26b&page=1', 'https://shop.test/s?q=a%26b&page=2']);
    });

    it('no pattern: a cursor, another path, another site, more than one number changing', () => {
        expect(urlPages('https://x.test/feed', '/feed?cursor=eyJpZCI6MTJ9')).toBeNull();
        expect(urlPages('https://x.test/a?page=1', '/b?page=2')).toBeNull();
        expect(urlPages('https://x.test/a?page=1', 'https://y.test/a?page=2')).toBeNull();
        expect(urlPages('https://x.test/a?page=1&size=10', '/a?page=2&size=20')).toBeNull();
        expect(urlPages('https://x.test/a?page=2', '/a?page=1')).toBeNull();
    });
});
