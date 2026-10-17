import { describe, expect, it } from 'vitest';
import { nextButtonSelectors } from './nextButton';

function count(selector: string): number {
    if (selector.startsWith('/')) return document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength;
    return document.querySelectorAll(selector).length;
}

describe('nextButtonSelectors', () => {
    it('stores the link a pick inside it means, with its text, and no page number', () => {
        document.body.innerHTML = `<nav class="pager"><a href="?page=1">1</a>
            <a class="pager-next" href="?page=3" aria-label="Go to page 3"><span class="icon">Next</span></a></nav>`;
        const chain = nextButtonSelectors(document.querySelector('.icon') as HTMLElement).map(c => c.selector);
        expect(chain).toContain('//a[normalize-space()="Next"]');
        expect(chain.some(s => /page 3|\?page/.test(s))).toBe(false);
        expect(chain.length).toBeLessThanOrEqual(3);
        for (const s of chain) expect(count(s), s).toBe(1);
    });

    it('accepts a pager shown twice (above and below the results), not other links', () => {
        const pager = `<div class="pager"><a href="#" class="prev">Previous</a><a href="#" class="next">Next page</a></div>`;
        document.body.innerHTML = `${pager}<ul><li>a</li></ul>${pager}<a href="#" class="next">Next article</a>`;
        const bottom = document.querySelectorAll('.pager .next')[1] as HTMLElement;
        const chain = nextButtonSelectors(bottom).map(c => c.selector);
        expect(chain).toContain('//a[normalize-space()="Next page"]');
        expect(chain).not.toContain('a.next');
    });

    it('writes a valid XPath for a label with quotes', () => {
        document.body.innerHTML = `<button>Don't miss more</button>`;
        const chain = nextButtonSelectors(document.querySelector('button') as HTMLElement).map(c => c.selector);
        expect(chain).toContain(`//button[normalize-space()="Don't miss more"]`);
        for (const s of chain) expect(count(s), s).toBe(1);
    });
});
