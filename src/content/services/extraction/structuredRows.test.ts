import { describe, it, expect } from 'vitest';
import { findStructuredSource } from './structuredRows';
import { readRow, structuredColumns } from './fieldSchema';
import { DataExtractor } from './DataExtractor';

const products = [
    { name: 'Desk Lamp', url: '/p/desk-lamp', sku: 'DL-1', price: '24.99', brand: 'Acme', rating: 4.5 },
    { name: 'Floor Lamp', url: '/p/floor-lamp', sku: 'FL-2', price: '59.00', brand: 'Lumo', rating: 4.1 },
    { name: 'Wall Light', url: '/p/wall-light', sku: 'WL-3', price: '15.50', brand: 'Acme', rating: 3.9 },
];

function page(order = products) {
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: products.map((p, i) => ({
            '@type': 'ListItem', position: i + 1,
            item: { '@type': 'Product', name: p.name, url: `https://shop.test${p.url}`, sku: p.sku, brand: { '@type': 'Brand', name: p.brand }, offers: { '@type': 'Offer', price: p.price, priceCurrency: 'USD' }, aggregateRating: { ratingValue: p.rating } },
        })),
    };
    document.head.innerHTML = `<base href="https://shop.test/search"><script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    // DOM order differs from JSON order: rows are matched by anchor, not position.
    document.body.innerHTML = `<ul>${order.map(p => `<li class="card"><a href="${p.url}"><h3>${p.name}</h3></a><span class="price">$${p.price}</span></li>`).join('')}</ul>`;
    return Array.from(document.querySelectorAll('.card'));
}

describe('structured data first', () => {
    it('finds the JSON-LD list behind the rows, anchored by URL, with named fields', () => {
        const rows = page();
        const src = findStructuredSource(rows)!;
        expect(src).toBeTruthy();
        expect(src.kind).toBe('ld');
        expect(src.anchorIsUrl).toBe(true);
        expect(src.matched).toBe(3);
        const names = src.fields.map(f => f.name);
        expect(names).toEqual(expect.arrayContaining(['Name', 'Url', 'Sku', 'Brand Name', 'Price', 'Price Currency', 'Rating Value']));
    });

    it('reads each row from its own item, whatever the order', () => {
        const rows = page([products[2], products[0], products[1]]);
        const cols = structuredColumns(findStructuredSource(rows)!);
        const id = (n: string) => cols.find(c => c.name === n)!.id;
        const first = readRow(rows[0], cols);
        expect(first[id('Name')]).toBe('Wall Light');
        expect(first[id('Sku')]).toBe('WL-3');
        expect(first[id('Brand Name')]).toBe('Acme');
        expect(cols.find(c => c.name === 'Price')!.type).toBe('price');
    });

    it('is offered next to the layout fields when a list is picked', () => {
        const rows = page();
        const data: any = new DataExtractor().extract(rows[0] as HTMLElement, { isContainer: true, siblings: rows });
        expect(data.structured.items).toHaveLength(3);
        expect(data.columns.every((c: any) => !c.reader.json)).toBe(true);
    });

    it('finds nothing when the JSON is about something else', () => {
        document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name: 'Shop' })}</script>`;
        document.body.innerHTML = '<ul><li class="c">A item</li><li class="c">B item</li></ul>';
        expect(findStructuredSource(Array.from(document.querySelectorAll('.c')))).toBeNull();
    });
});
