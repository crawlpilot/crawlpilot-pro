import { describe, expect, it } from 'vitest';
import { elementChain } from './element';

const first = (el: Element) => elementChain(el)[0].selector;

function resolve(selector: string): Element[] {
    if (selector.startsWith('/')) {
        const r = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        return Array.from({ length: r.snapshotLength }, (_, i) => r.snapshotItem(i) as Element);
    }
    return Array.from(document.querySelectorAll(selector));
}

describe('elementChain', () => {
    it('names a spec value by its label, not its row number', () => {
        document.body.innerHTML = `<table id="specs"><tbody>
            <tr><th>Brand</th><td>Acme</td></tr><tr><th>Weight</th><td>2 kg</td></tr><tr><th>Colour</th><td>Red</td></tr>
        </tbody></table>`;
        const weight = document.querySelectorAll('td')[1];
        expect(first(weight)).toBe('//th[normalize-space()="Weight"]/following-sibling::td[1]');
        expect(elementChain(weight).every(c => !/nth-|tr\[\d\]/.test(c.selector))).toBe(true);
    });

    it('prefers a test id or stable id, and scopes a shared class under a named ancestor', () => {
        document.body.innerHTML = `<div data-testid="buybox"><span class="price">$5</span></div>
            <div class="recs"><span class="price">$9</span><span class="price">$7</span></div>
            <h1 id="productTitle" class="title">Lamp</h1>`;
        expect(first(document.querySelector('h1')!)).toBe('#productTitle');
        expect(first(document.querySelector('[data-testid] .price')!)).toBe('[data-testid="buybox"] span.price');
    });

    it('never names a value by its text or an item id, but a control by its label', () => {
        document.body.innerHTML = `<ul>${[1, 2, 3].map(i => `<li data-item-id="SKU${i}00${i}"><a href="/p/${i}">Lamp ${i}</a></li>`).join('')}</ul>
            <nav><a href="/s?page=2">Next</a></nav>`;
        const value = document.querySelectorAll('li a')[1];
        for (const c of elementChain(value)) {
            expect(c.selector).not.toMatch(/Lamp|SKU|\/p\//);
            expect(resolve(c.selector)).toEqual([value]);
        }
        const next = document.querySelector('nav a')!;
        expect(elementChain(next, { control: true }).map(c => c.selector)).toContain('//a[normalize-space()="Next"]');
    });

    it('falls back to a unique path from the nearest named ancestor when nothing names it', () => {
        document.body.innerHTML = `<section id="results">${'<div><p>x</p><p>y</p></div>'.repeat(3)}</section>`;
        const target = document.querySelectorAll('#results p')[3];
        const chain = elementChain(target);
        expect(chain[0].selector).toBe('#results > div:nth-of-type(2) > p:nth-of-type(2)');
        for (const c of chain) expect(resolve(c.selector)).toEqual([target]);
    });
});
