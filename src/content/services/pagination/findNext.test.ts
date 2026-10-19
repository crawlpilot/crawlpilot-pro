import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loadPage } from '../../../test/corpus/measure';
import { findNextControl } from './findNext';

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
});
