import { describe, it, expect } from 'vitest';
import { findLoadMore, settle } from './settle';

describe('findLoadMore', () => {
    it('finds the "Show more" after the list, not a "See more" above it, nor a hidden or disabled one', () => {
        document.body.innerHTML = `<button id="above">See more</button><ul id="list"><li>a</li></ul>
            <button id="off" disabled>Load more</button><button id="gone" style="display:none">Show more</button>
            <a id="more" href="#">Show 24 more results</a><button id="other">More options</button>`;
        expect(findLoadMore(document.getElementById('list')!)?.id).toBe('more');
    });

    it('finds a control by its hook when its text is an icon', () => {
        document.body.innerHTML = `<ul id="list"><li>a</li></ul><div data-show-more-virtual-list="true"><span>⌄</span></div>`;
        expect(findLoadMore(document.getElementById('list')!)?.hasAttribute('data-show-more-virtual-list')).toBe(true);
    });

    it('finds nothing on a list with no such control', () => {
        document.body.innerHTML = `<ul id="list"><li>a</li></ul><a href="/next">Next page</a>`;
        expect(findLoadMore(document.getElementById('list')!)).toBeNull();
    });
});

describe('settle', () => {
    it('waits while the page keeps changing, then resolves once quiet', async () => {
        document.body.innerHTML = '<ul id="l"></ul>';
        const l = document.getElementById('l')!;
        let added = 0;
        const timer = setInterval(() => { if (added < 3) { l.appendChild(document.createElement('li')); added++; } }, 50);
        const start = Date.now();
        await settle(document.body, 120, 2000);
        clearInterval(timer);
        expect(added).toBe(3);
        expect(Date.now() - start).toBeLessThan(1000);
    });
});
