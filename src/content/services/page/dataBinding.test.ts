import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { bindToData, readBinding } from './dataBinding';
import { extractPage } from './extractPage';
import { loadPage } from '../../../test/corpus/measure';

beforeAll(() => { Element.prototype.scrollIntoView = () => undefined; });

/** Another product's page: the same page with its data changed. */
function otherProduct() {
    const script = document.getElementById('__NEXT_DATA__')!;
    const data = JSON.parse(script.textContent!);
    const d = data.props.pageProps.initialData.data;
    Object.assign(d.product.priceInfo.currentPrice, { price: 219.5, priceString: '$219.50', priceDisplay: '$219.50', variantPriceString: '$219.50' });
    d.idml.specifications = [{ name: 'Brand', value: 'Char-Broil' }, { name: 'Btu', value: '36000' }, { name: 'Fuel type', value: 'Natural gas' }];
    // A new script element: the sources cache is keyed by the page's scripts.
    const fresh = document.createElement('script');
    fresh.id = '__NEXT_DATA__';
    fresh.type = 'application/json';
    fresh.textContent = JSON.stringify(data);
    script.replaceWith(fresh);
}

const add = (html: string) => { const box = document.createElement('div'); box.innerHTML = html; document.body.appendChild(box); return box.firstElementChild as HTMLElement; };

describe('Page Extractor fields bound to the page\'s data (walmart.com/ip/EG-4-BURNER-GRILL)', { timeout: 30_000 }, () => {
    beforeEach(() => loadPage('corpus/pdp-walmart.html.gz'));

    it('binds the shown price to the product\'s price, not a variant\'s or an ad\'s, and reads the next product\'s', () => {
        const price = add('<span class="price">$194.00</span>');
        const b = bindToData(price, 'text')!;
        expect(b).not.toBeNull();
        expect(JSON.stringify(b.path)).toContain('"product","priceInfo","currentPrice"');
        expect(JSON.stringify(b.path)).not.toMatch(/variantsMap|modules/);
        otherProduct();
        expect(readBinding(b)).toBe('$219.50');
    });

    it('binds a specs table opened by a click to the specs list, choosing items by their label', () => {
        const table = add(`<table><tbody>
            <tr><td>Fuel type</td><td>Propane</td></tr>
            <tr><td>Brand</td><td>Expert Grill</td></tr>
            <tr><td>Btu</td><td>48000</td></tr></tbody></table>`);
        const b = bindToData(table, 'table')!;
        expect(b).toMatchObject({ as: 'rows', keys: ['name', 'value'] });
        expect(b.path[b.path.length - 1]).toMatch(/specifications/);
        otherProduct();
        expect(readBinding(b)).toEqual([['Brand', 'Char-Broil'], ['Btu', '36000'], ['Fuel type', 'Natural gas']]);
    });

    it('a run reads bound fields from the data and skips the click that only revealed them', async () => {
        const price = add('<span class="price">$194.00</span>');
        const btn = add('<button id="specs-btn">Specifications</button>');
        let clicked = 0;
        btn.addEventListener('click', () => clicked++);
        const table = add('<table id="specs"><tbody><tr><td>Fuel type</td><td>Propane</td></tr><tr><td>Brand</td><td>Expert Grill</td></tr></tbody></table>');
        const elements = [
            { id: 'price', name: 'Price', action: 'extract' as const, type: 'text', selectors: ['span.price'], data: bindToData(price, 'text')! },
            { id: 'open', name: 'Open specs', action: 'click' as const, type: 'text', selectors: ['#specs-btn'] },
            { id: 'specs', name: 'Specs', action: 'extract' as const, type: 'table', selectors: ['#specs'], data: bindToData(table, 'table')! },
        ];
        otherProduct();
        // The next product's page shows neither (the section is closed).
        price.remove(); table.remove();
        const record = await extractPage(elements, {});
        expect(clicked).toBe(0);
        expect(record.steps.map(s => `${s.id}:${s.status}`)).toEqual(['price:data', 'open:skipped', 'specs:data']);
        expect(record.item.price).toBe('$219.50');
        expect(JSON.parse(record.item.specs)).toEqual([['Brand', 'Char-Broil'], ['Btu', '36000'], ['Fuel type', 'Natural gas']]);
    });

    it('binds nothing for a value the data doesn\'t hold', () => {
        expect(bindToData(add('<p>Free pickup at your store</p>'), 'text')).toBeNull();
    });
});
