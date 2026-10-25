import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loadPage } from '../../../test/corpus/measure';
import { findNextControl, type ListContext } from './findNext';

const site = (f: string) => { document.documentElement.innerHTML = readFileSync(resolve(__dirname, '../../../../e2e/site', f), 'utf8'); };

describe('findNextControl (a list runs over its pages in one click)', { timeout: 30_000 }, () => {
    it("finds Amazon's pager Next", () => {
        loadPage('corpus/amazon-search.html.gz');
        expect(findNextControl(document)).toMatchObject({ mode: 'pagination', label: 'Next' });
        expect(findNextControl(document)!.selectors[0]).toBe('a.s-pagination-next');
    });

    it('follows rel="next", and finds a "Show more" button', () => {
        site('list-1.html');
        expect(findNextControl(document)).toMatchObject({ mode: 'pagination', label: 'Next page' });
        site('late.html');
        expect(findNextControl(document)).toMatchObject({ mode: 'loadMore', label: 'Show more' });
    });

    it("ignores a carousel's Next arrow (Walmart's product scroller): no pager, no pages", () => {
        loadPage('corpus/walmart-search.html.gz');
        expect(findNextControl(document)).toBeNull();
    });

    it('skips a disabled Next on the last page', () => {
        document.body.innerHTML = '<nav class="pagination"><a href="/p/1">1</a><a href="/p/2" class="next disabled" aria-disabled="true">Next</a></nav>';
        expect(findNextControl(document)).toBeNull();
    });

    describe("with the picked list: the list's own control", () => {
        const list = (): ListContext => {
            const container = document.querySelector('#list')!;
            return { container, items: Array.from(container.querySelectorAll('.card')) };
        };
        const cards = '<div class="card"><a href="/p/1">One</a></div><div class="card"><a href="/p/2">Two</a></div>';

        it('passes over a filter sidebar\'s "Show more" before the list for the one below it', () => {
            document.body.innerHTML = `<div class="layout"><div class="filters"><button>Show more</button></div>
                <div id="list">${cards}</div><button class="load">Load more</button></div>`;
            expect(findNextControl(document, list())).toMatchObject({ mode: 'loadMore', label: 'Load more' });
        });

        it('skips a "See more" disclosure and a "Show more brands" button', () => {
            document.body.innerHTML = `<p>About <button aria-expanded="false">See more</button></p><button>Show more brands</button><div id="list">${cards}</div>`;
            expect(findNextControl(document, list())).toBeNull();
        });

        it("ignores a Next arrow inside a card, and finds the pager's icon-only arrow after the list", () => {
            document.body.innerHTML = `<div id="list"><div class="card"><a href="/p/1">One</a><a href="/p/1?img=2">Next</a></div><div class="card"><a href="/p/2">Two</a></div></div>
                <div class="pagination"><a href="?page=1">1</a><a href="?page=2">2</a><a href="?page=2" class="pagination__next"><svg></svg></a></div>`;
            const found = findNextControl(document, list());
            expect(found?.mode).toBe('pagination');
            expect(document.querySelector(found!.selectors[0])).toBe(document.querySelector('.pagination__next'));
        });

        it("prefers the list's pager to another list's on the same page", () => {
            document.body.innerHTML = `<section><div class="other">${cards.replace(/card/g, 'tile')}</div><nav><a href="/news?p=2">Next</a></nav></section>
                <section><div id="list">${cards}</div><nav class="pager"><a href="/shop?page=2" class="go">Next</a></nav></section>`;
            const found = findNextControl(document, list());
            expect(document.querySelector(found!.selectors[0])).toBe(document.querySelector('a.go'));
        });

        it("still finds Amazon's pager Next inside the results slot", () => {
            loadPage('corpus/amazon-search.html.gz');
            const container = document.querySelector('.s-main-slot')!;
            const items = Array.from(container.querySelectorAll('[data-component-type="s-search-result"]'));
            expect(findNextControl(document, { container, items })).toMatchObject({ mode: 'pagination', label: 'Next' });
        });
    });
});
