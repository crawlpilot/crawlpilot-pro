import { describe, it, expect } from 'vitest';
import { DataExtractor } from '../DataExtractor';
import { readRow } from '.';

const products = [1, 2, 3, 4, 5].map(i => ({ id: `SKU${i}0042`, name: `Lamp ${i}`, price: i * 10 + 0.99, averageRating: 4 + i / 10 }));

function page(opts: { skeleton: number[]; jsonPrice?: (p: typeof products[0]) => number }) {
    const state = { props: { results: { items: products.map(p => ({ ...p, price: opts.jsonPrice ? opts.jsonPrice(p) : p.price })) } } };
    document.body.innerHTML = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state)}</script>
        <ul>${products.map((p, i) => `<li class="card" data-item-id="${p.id}"><a href="/p/${i + 1}"><h3>${p.name}</h3></a>
            <span class="price">${opts.skeleton.includes(i) ? '' : `$${p.price}`}</span></li>`).join('')}</ul>`;
    const rows = Array.from(document.querySelectorAll('.card'));
    const data: any = new DataExtractor().extract(rows[0] as HTMLElement, { isContainer: true, siblings: rows } as any);
    const price = (data.columns as any[]).find(c => c.name === 'Price');
    return { rows, data, price };
}

describe('the page’s own data behind the fields (L5)', () => {
    it('matches rows to the JSON items by ID and fills a price that never rendered', () => {
        const { data, price } = page({ skeleton: [1, 3] });
        expect(data.structured.label).toBe('__NEXT_DATA__');
        expect(data.items.map((i: any) => i[price.id])).toEqual(['$10.99', '20.99', '$30.99', '40.99', '$50.99']);
    });

    it('leaves the field alone when the data disagrees with what the page shows', () => {
        const { rows, data, price } = page({ skeleton: [1, 3], jsonPrice: p => p.price + 5 });
        expect(price.reader.alternates ?? []).toEqual([]);
        expect(readRow(rows[1], data.columns)[price.id]).toBeUndefined();
    });
});
