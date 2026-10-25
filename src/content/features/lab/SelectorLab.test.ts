import { describe, expect, it } from 'vitest';
import { storedFor } from './SelectorLab';
import { resolveOne } from '../../../shared/selectors/resolve';

describe('storedFor', () => {
    it('marks the entry a run would use, and a later one when the first broke', () => {
        document.body.innerHTML = `<div id="buybox"><span id="price" class="price">$5</span></div>`;
        const price = document.getElementById('price')!;
        const first = storedFor(price);
        expect(first.stored.length).toBeGreaterThan(1);
        expect(first.stored.findIndex(e => e.wins)).toBe(0);

        // The site renames the id: the stored chain's first entry stops matching, a backup answers.
        const chain = first.stored.map(e => e.selector);
        price.id = 'price-v2';
        expect(resolveOne(chain).used).toBeGreaterThan(0);
    });

    it('shows the list chains for an element with look-alike siblings', () => {
        document.body.innerHTML = `<ul id="results">${[1, 2, 3, 4].map(i => `<li class="card"><a href="/p/${i}">Item ${i}</a><span>$${i}</span></li>`).join('')}</ul>`;
        const { storedList } = storedFor(document.querySelectorAll('li')[1] as HTMLElement);
        expect(storedList?.container[0]).toMatchObject({ selector: '#results', wins: true });
        expect(storedList?.items.some(e => e.wins && e.count === 4)).toBe(true);
    });
});
