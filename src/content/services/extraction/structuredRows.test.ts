import { describe, it, expect, vi } from 'vitest';
import { findStructuredSource, jsonValueAt, refreshNetSources } from './structuredRows';

const net = vi.hoisted(() => ({ entries: [] as any[] }));
vi.mock('../../features/network/NetworkRelay', () => ({
    requestNetEntries: async () => ({ installed: true, entries: net.entries }),
}));
import { readRow, structuredColumns } from './fields';
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
        const data: any = new DataExtractor().extract(rows[0] as HTMLElement, { isContainer: true, siblings: rows as HTMLElement[], container: null, childCount: rows.length });
        expect(data.structured.items).toHaveLength(3);
        expect(data.columns.every((c: any) => !c.reader.json)).toBe(true);
    });

    it('finds nothing when the JSON is about something else', () => {
        document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name: 'Shop' })}</script>`;
        document.body.innerHTML = '<ul><li class="c">A item</li><li class="c">B item</li></ul>';
        expect(findStructuredSource(Array.from(document.querySelectorAll('.c')))).toBeNull();
    });
});

describe('more sources', () => {
    const cards = (names: string[]) => {
        document.body.innerHTML = `<ul>${names.map(n => `<li class="card"><a href="/item/${n.toLowerCase()}">${n}</a></li>`).join('')}</ul>`;
        return Array.from(document.querySelectorAll('.card'));
    };

    it('scans inline JSON values, strings with brackets included', () => {
        const text = 'window.__STATE__ = {"a":"x}]","b":[1,{"c":2}]}; window.other = 1;';
        expect(jsonValueAt(text, text.indexOf('{'))).toEqual({ a: 'x}]', b: [1, { c: 2 }] });
        expect(jsonValueAt('= notjson', 2)).toBeUndefined();
    });

    it('reads inline window state', async () => {
        net.entries = [];
        await refreshNetSources();
        const state = { search: { results: ['Alpha', 'Bravo', 'Charlie'].map((n, i) => ({ title: n, link: `/item/${n.toLowerCase()}`, stock: 10 + i })) }, pad: 'x'.repeat(300) };
        document.head.innerHTML = `<base href="https://shop.test/"><script>window.__INITIAL_STATE__ = ${JSON.stringify(state)};</script>`;
        const src = findStructuredSource(cards(['Alpha', 'Bravo', 'Charlie']))!;
        expect(src.kind).toBe('state');
        expect(src.label).toBe('__INITIAL_STATE__');
        expect(src.fields.map(f => f.name)).toEqual(expect.arrayContaining(['Title', 'Link', 'Stock']));
    });

    it('reads recorded API responses, newest first', async () => {
        document.head.innerHTML = '<base href="https://shop.test/">';
        net.entries = [{ seq: 1, url: 'https://shop.test/api/search?page=1', responseText: JSON.stringify({ data: { items: ['Delta', 'Echo', 'Fox'].map(n => ({ name: n, href: `/item/${n.toLowerCase()}`, sold: 5 })) } }) }];
        await refreshNetSources();
        const rows = cards(['Delta', 'Echo', 'Fox']);
        const src = findStructuredSource(rows)!;
        expect(src.kind).toBe('api');
        const cols = structuredColumns(src);
        expect(readRow(rows[1], cols)[cols.find(c => c.name === 'Name')!.id]).toBe('Echo');
        net.entries = [];
        await refreshNetSources();
    });
});

describe('a feed\'s data (docs/plans/virtual-feeds-plan.md §3.3)', () => {
    const node = (code: string, n: number) => ({ node: { code, pk: String(900 + n), caption: { text: `Post ${n}` }, taken_at: 1790000000 + n, media_type: 1 } });
    function grid(codes: string[]) {
        // The first posts 14 levels down in the bootstrap, as on Instagram.
        let nested: any = { result: { data: { user: { timeline: { edges: codes.slice(0, 3).map((c, i) => node(c, i + 1)) } } } } };
        for (let i = 0; i < 5; i++) nested = { __bbox: { require: [['Cache', 'next', [], [`k${i}`, nested]]] } };
        document.head.innerHTML = `<base href="https://social.test/alpha/"><script type="application/json">${JSON.stringify({ require: [['Handle', null, [nested]]] })}</script>`;
        document.body.innerHTML = `<div>${codes.map(c => `<div class="cell"><a href="/alpha/p/${c}/"><img alt=""></a></div>`).join('')}</div>`;
        return Array.from(document.querySelectorAll('.cell'));
    }

    it('finds items deep in an app\'s bootstrap, by link codes with or without digits; names and dates read well', () => {
        const rows = grid(['DesR-VXRAQU', 'Dh9xQ2bLmP0', 'KwTpRmZaBcD', 'Zq1aaaBBBcc']);
        const src = findStructuredSource(rows)!;
        expect(src).toBeTruthy();
        expect(src.anchor).toBe('node.code');
        expect(src.fields.find(f => f.key === 'node.caption.text')?.name).toBe('Caption Text');
        expect(src.fields.find(f => f.key === 'node.taken_at')).toMatchObject({ name: 'Taken At', type: 'date' });
        const cols = structuredColumns(src);
        const taken = cols.find(c => c.name === 'Taken At')!;
        expect(readRow(rows[0], cols)[taken.id]).toBe(new Date((1790000000 + 1) * 1000).toISOString());
    });

    it('rows a scroll loaded are read from the API page that brought them, wherever it keeps its array', async () => {
        const rows = grid(['DesR-VXRAQU', 'Dh9xQ2bLmP0', 'KwTpRmZaBcD', 'Zq1aaaBBBcc']);
        const cols = structuredColumns(findStructuredSource(rows)!);
        const caption = cols.find(c => c.name === 'Caption Text')!;
        expect(readRow(rows[3], cols)[caption.id]).toBeUndefined();
        net.entries = [{ seq: 50, url: 'https://social.test/graphql', responseText: JSON.stringify({ data: { xdt_feed: { edges: [node('Zq1aaaBBBcc', 4), node('Other00001x', 5)] } } }) }];
        await refreshNetSources();
        expect(readRow(rows[3], cols)[caption.id]).toBe('Post 4');
        net.entries = [];
        await refreshNetSources();
    });
});
