import { describe, expect, it } from 'vitest';
import { listLocators } from './list';

const card = (i: number, extra = '') =>
    `<div class="result" data-index="${i}" data-kind="product"${extra}><h2>Item ${i}</h2><span class="price">$${i}.99</span><div data-index="x${i}"></div></div>`;

function items(root: Element, selector: string): Element[] {
    if (selector.startsWith('.') || selector.startsWith('/')) {
        if (selector.startsWith('./')) {
            const r = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            return Array.from({ length: r.snapshotLength }, (_, i) => r.snapshotItem(i) as Element);
        }
    }
    return Array.from(root.querySelectorAll(selector));
}

describe('listLocators', () => {
    it('stores only selectors that match exactly the items, not nested look-alikes or ads', () => {
        document.body.innerHTML = `<main><div id="results">
            <div class="banner"><p>Results for "lamp"</p></div>
            ${[1, 2, 3, 4, 5].map(i => card(i)).join('')}
            <div class="ad" data-index="99"><img src="/ad.png"><a href="/ad">Sponsored video</a></div>
        </div></main>`;
        const container = document.getElementById('results')!;
        const { container: chain, items: itemChain } = listLocators(container, Array.from(container.children) as HTMLElement[]);
        expect(chain[0].selector).toBe('#results');
        const cards = Array.from(container.querySelectorAll(':scope > [data-kind]'));
        expect(itemChain.length).toBeGreaterThan(1);
        for (const entry of itemChain) expect(items(container, entry.selector), entry.selector).toEqual(cards);
        // `[data-index]` alone matches the nested markers and the ad: never stored.
        expect(itemChain.map(e => e.selector)).not.toContain('[data-index]');
        expect(itemChain.some(e => e.selector.startsWith('./'))).toBe(true);
    });

    it('moves the container up to an ancestor it can name, never storing a position', () => {
        document.body.innerHTML = `<section data-testid="search-results"><div><div>
            ${[1, 2, 3, 4].map(i => card(i)).join('')}
        </div></div></section><div><div>${card(9)}</div></div>`;
        const list = document.querySelector('section > div > div') as HTMLElement;
        const { container, items: itemChain } = listLocators(list, Array.from(list.children) as HTMLElement[]);
        expect(container[0].selector).toBe('[data-testid="search-results"]');
        expect(container.every(c => !/nth-|\[\d+\]/.test(c.selector))).toBe(true);
        const root = document.querySelector('section')!;
        expect(items(root, itemChain[0].selector)).toEqual(Array.from(list.children));
    });
});
