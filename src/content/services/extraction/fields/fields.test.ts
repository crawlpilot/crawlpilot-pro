import { describe, it, expect, beforeEach } from 'vitest';
import { inferFields, readRow, hasReaders, unmappedCount } from '.';
import { alignToTemplate, atomText, collectAtoms } from '../atoms';
import { loadPage } from '../../../../test/corpus/measure';

function rowsOf(html: string, selector = '.card'): Element[] {
    document.body.innerHTML = html;
    return Array.from(document.querySelectorAll(selector));
}

const card = (o: { title: string; price: string; was?: string; brand?: string; badge?: string; sponsored?: boolean; href?: string }) => {
    const inner = `
        <a class="card-link" href="${o.href ?? '/p/' + o.title.toLowerCase().replace(/\s+/g, '-')}"><img class="thumb" src="/img/${o.title.length}.jpg"></a>
        <h3 class="card-title"><a href="${o.href ?? '/p/' + o.title.toLowerCase().replace(/\s+/g, '-')}">${o.title}</a></h3>
        ${o.badge ? `<span class="badge">${o.badge}</span>` : ''}
        ${o.brand ? `<div class="brand">${o.brand}</div>` : ''}
        <div class="price"><span class="sym">$</span><span class="whole">${o.price.split('.')[0]}</span><sup>${o.price.split('.')[1]}</sup></div>
        ${o.was ? `<div class="price-was"><s>$${o.was}</s></div>` : ''}
        <button class="add">Add to cart</button>`;
    return `<li class="card">${o.sponsored ? `<div class="sponsored-wrap">${inner}</div>` : inner}</li>`;
};

describe('atoms', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('reads a split price as one value', () => {
        document.body.innerHTML = '<div id="p"><span>$</span><span>24</span><sup>99</sup></div>';
        expect(atomText(document.getElementById('p')!)).toBe('$24.99');
    });

    it('skips the aria-hidden visual copy of a screen-reader price', () => {
        document.body.innerHTML = '<span id="p"><span class="a-offscreen">$24.99</span><span aria-hidden="true">$<span>24</span>.<span>99</span></span></span>';
        expect(atomText(document.getElementById('p')!)).toBe('$24.99');
    });

    it('keeps sibling values apart but byline + link together', () => {
        const [row] = rowsOf('<div class="card"><div class="meta"><span class="brand">Acme</span><span class="sku">SKU 12</span></div><p class="by">By <a href="/a">Ann</a></p></div>');
        const texts = collectAtoms(row).filter(a => a.attr === 'text').map(a => a.value);
        expect(texts).toEqual(['Acme', 'SKU 12', 'By Ann']);
    });

    it('aligns a row missing its first repeated value', () => {
        expect(alignToTemplate(['number', 'count'], ['text', 'number', 'count'])).toEqual([1, 2]);
        expect(alignToTemplate(['text', 'number', 'count'], ['text', 'number', 'count'])).toEqual([0, 1, 2]);
    });
});

describe('inferFields', () => {
    const listing = `<ul>
        ${card({ title: 'Desk Lamp', price: '24.99', was: '29.99', brand: 'Acme' })}
        ${card({ title: 'Floor Lamp', price: '59.00', badge: 'Best seller' })}
        ${card({ title: 'Wall Light', price: '15.50', brand: 'Lumo', sponsored: true })}
        ${card({ title: 'Table Lamp', price: '33.10', brand: 'Acme' })}
        ${card({ title: 'Reading Lamp', price: '19.00', was: '25.00' })}
    </ul>`;

    it('produces one named column per field, no duplicates, no button caption', () => {
        const { columns } = inferFields(rowsOf(listing));
        const names = columns.map(c => c.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names).toEqual(expect.arrayContaining(['Image', 'Title', 'Price', 'Was Price', 'Brand', 'Badge', 'URL']));
        expect(names).not.toContain('Add');
        expect(names.filter(n => /URL/.test(n))).toHaveLength(1); // image link and title link are the same URL
        expect(columns.every(c => c.id === c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))).toBe(true);
        expect(hasReaders(columns)).toBe(true);
    });

    it('reads the sponsored card (extra wrapper) into the same columns', () => {
        const rows = rowsOf(listing);
        const { columns } = inferFields(rows);
        const wall = readRow(rows[2], columns);
        const byName = (n: string) => columns.find(c => c.name === n)!.id;
        expect(wall[byName('Title')]).toBe('Wall Light');
        expect(wall[byName('Price')]).toBe('$15.50');
        expect(wall[byName('Brand')]).toBe('Lumo');
    });

    it('keeps the struck price apart from the current price', () => {
        const rows = rowsOf(listing);
        const { columns } = inferFields(rows);
        const row = readRow(rows[0], columns);
        const id = (n: string) => columns.find(c => c.name === n)!.id;
        expect(row[id('Price')]).toBe('$24.99');
        expect(row[id('Was Price')]).toBe('$29.99');
        expect(readRow(rows[1], columns)[id('Was Price')]).toBeUndefined();
    });

    it('reads a later page with the same column IDs, including rows with an extra badge', () => {
        const { columns } = inferFields(rowsOf(listing));
        const page2 = rowsOf(`<ul>
            ${card({ title: 'Pendant', price: '80.00', badge: 'New', brand: 'Acme' })}
            ${card({ title: 'Spot', price: '9.99' })}
        </ul>`);
        const rows = page2.map(r => readRow(r, columns));
        const id = (n: string) => columns.find(c => c.name === n)!.id;
        expect(rows[0]).toMatchObject({ [id('Title')]: 'Pendant', [id('Badge')]: 'New', [id('Brand')]: 'Acme', [id('Price')]: '$80.00' });
        expect(rows[1]).toMatchObject({ [id('Title')]: 'Spot', [id('Price')]: '$9.99' });
        const known = new Set(columns.map(c => c.id));
        rows.forEach(r => Object.keys(r).forEach(k => expect(known.has(k)).toBe(true)));
    });

    it('splits same-class siblings into slots by shape, even when one is missing', () => {
        const people = [
            ['Nitin K', 'Senior Engineer', '4.5 out of 5 stars'],
            ['Ronit S', 'Recruiter', '4.0 out of 5 stars'],
            ['Asha P', 'Designer', '3.5 out of 5 stars'],
        ];
        const rows = rowsOf(`<div>${people.map(p => `<div class="card"><div class="x9f"><p class="t">${p[0]}</p><p class="t">${p[1]}</p><p class="t">${p[2]}</p></div></div>`).join('')}
            <div class="card"><div class="x9f"><p class="t">Mia L</p><p class="t">2.0 out of 5 stars</p></div></div></div>`);
        const { columns } = inferFields(rows);
        expect(columns).toHaveLength(3);
        const rating = columns.find(c => c.name === 'Rating')!;
        expect(rating).toBeTruthy();
        const last = readRow(rows[3], columns);
        expect(last[rating.id]).toBe('2.0 out of 5 stars');
        expect(Object.values(last)).toEqual(expect.arrayContaining(['Mia L']));
        expect(Object.values(last)).toHaveLength(2);
    });

    it('collects a gallery as one image list', () => {
        const rows = rowsOf(`<div>${[1, 2, 3].map(i => `<div class="card"><h2>Item ${i}</h2><div class="gallery"><img src="/a${i}.jpg"><img src="/b${i}.jpg"></div></div>`).join('')}</div>`);
        const { columns } = inferFields(rows);
        const images = columns.find(c => c.type === 'image_array')!;
        expect(images.name).toBe('Images');
        expect(JSON.parse(readRow(rows[0], columns)[images.id])).toHaveLength(2);
    });

    it('names from itemprop and dt/dd', () => {
        const rows = rowsOf(`<div>${[1, 2].map(i => `<div class="card"><span itemprop="name">N${i}</span><span itemprop="sku">S-${i}</span></div>`).join('')}</div>`);
        expect(inferFields(rows).columns.map(c => c.name)).toEqual(['Name', 'Sku']);
        const defs = rowsOf(`<dl>${[1, 2, 3].map(i => `<div class="card"><dt>Key ${i}</dt><dd>Val ${i}</dd></div>`).join('')}</dl>`);
        expect(inferFields(defs).columns.map(c => c.name)).toEqual(['Label', 'Value']);
    });

    it('counts content no field reads on a later page', () => {
        const { columns } = inferFields(rowsOf(listing));
        const [row] = rowsOf(`<ul>${card({ title: 'Pendant', price: '80.00' }).replace('</li>', '<p class="eco">Eco certified</p></li>')}</ul>`);
        expect(unmappedCount(row, columns)).toBe(1);
        const [plain] = rowsOf(`<ul>${card({ title: 'Spot', price: '9.99' })}</ul>`);
        expect(unmappedCount(plain, columns)).toBe(0);
    });

    it('reads only its kind of value after a split', () => {
        const rows = rowsOf(`<div>${['$5.00', 'Free shipping', '$7.50'].map(m => `<div class="card"><h3>T ${m}</h3><span class="meta">${m}</span></div>`).join('')}</div>`);
        const meta = inferFields(rows).columns.find(c => c.reader!.chain[0].includes('.meta'))!;
        const priceOnly = { ...meta, id: 'p', reader: { ...meta.reader!, onlyShape: 'price' as const } };
        expect(readRow(rows[0], [priceOnly])).toEqual({ p: '$5.00' });
        expect(readRow(rows[1], [priceOnly])).toEqual({});
    });

    it('reports identical rows', () => {
        const rows = rowsOf(`<div>${'<div class="card"><span class="a">Same</span><span class="b">Thing</span></div>'.repeat(3)}</div>`);
        expect(inferFields(rows).problems.join(' ')).toMatch(/identical/);
    });
});

describe('variations across a long list', () => {
    it('learns a card layout that only appears after the first 40 rows', () => {
        const plain = (i: number) => card({ title: `Lamp ${i}`, price: `${10 + i}.99` });
        const deal = (i: number) => `<li class="card">
            <a class="card-link" href="/p/deal-${i}"><img class="thumb" src="/img/d${i}.jpg"></a>
            <h3 class="card-title"><a href="/p/deal-${i}">Deal lamp ${i}</a></h3>
            <div class="deal"><span class="deal-tag">Limited deal</span><span class="deal-price">$${i}.49</span></div>
        </li>`;
        const rows = rowsOf(`<ul>${Array.from({ length: 60 }, (_, i) => (i < 45 ? plain(i) : deal(i))).join('')}</ul>`);
        const { columns } = inferFields(rows);
        const price = columns.find(c => c.name === 'Price')!;
        expect(price).toBeTruthy();
        // The deal layout's price is the same column (an alternate reader), not a column of its own.
        expect(columns.filter(c => c.type === 'price')).toHaveLength(1);
        expect(readRow(rows[50], columns)[price.id]).toBe('$50.49');
        expect(readRow(rows[3], columns)[price.id]).toBe('$13.99');
        expect(columns.some(c => Object.values(readRow(rows[50], columns)).includes('Limited deal') && c)).toBe(true);
        expect(unmappedCount(rows[50], columns)).toBe(0);
    });
});

describe('Amazon-style search results', () => {
    // Markup modelled on amazon.com/s?k=laptop: cards share the results slot with headers, widgets,
    // a video ad and footers; prices come as a screen-reader copy plus an aria-hidden visual copy.
    const price = (p: string) => `<span class="a-price"><span class="a-offscreen">${p}</span><span aria-hidden="true"><span class="a-price-symbol">$</span><span class="a-price-whole">${p.slice(1).split('.')[0]}<span class="a-price-decimal">.</span></span><span class="a-price-fraction">${p.split('.')[1]}</span></span></span>`;
    const card = (i: number, o: { list?: string; badge?: string; bought?: string; sponsored?: boolean }) => `
        <div data-component-type="s-search-result" data-asin="B0${i}" class="s-result-item s-asin">
          <div class="puis-card-container s-card-container">
            <span class="rush-component"><a class="a-link-normal s-no-outline" href="/Laptop-${i}/dp/B0000000${i}/ref=sr_1_${i}?keywords=laptop"><img class="s-image" src="https://m.media-amazon.com/images/I/${i}.jpg" alt="Laptop ${i}"></a></span>
            ${o.sponsored ? '<span class="puis-sponsored-label-text">Sponsored</span>' : ''}
            ${o.badge ? `<span class="a-badge-text puis-bold-weight-text">${o.badge}</span>` : ''}
            <div data-cy="title-recipe"><a class="a-link-normal s-link-style" href="/Laptop-${i}/dp/B0000000${i}/ref=sr_1_${i}?keywords=laptop"><h2 class="a-size-medium"><span>Laptop model ${i} with ${i * 4}GB RAM</span></h2></a></div>
            <div data-cy="reviews-block"><div class="a-row"><span class="a-declarative"><a href="#" aria-label="4.${i} out of 5 stars"><span class="a-icon-alt">4.${i} out of 5 stars</span></a></span>
              <span class="s-csa-instrumentation-wrapper"><a href="/Laptop-${i}/dp/B0000000${i}/ref=sr_1_${i}#customerReviews"><span class="s-underline-text">(${i * 37})</span></a></span></div>
              ${o.bought ? `<div class="a-row"><span class="a-size-base a-color-secondary">${o.bought}</span></div>` : ''}</div>
            <div data-cy="price-recipe"><div class="a-row"><span class="a-offscreen">Price, product page</span><a href="/Laptop-${i}/dp/B0000000${i}">${price(`$${i}99.99`)}</a>
              ${o.list ? `<div class="a-section aok-inline-block"><span class="a-size-base a-color-secondary">List:</span><span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">${o.list}</span><span aria-hidden="true">${o.list}</span></span></div>` : ''}</div></div>
            <div data-cy="delivery-recipe"><div class="a-row"><span aria-label="$2${i}.96 delivery Mon, Nov 2"><span class="a-color-base">$2${i}.96 delivery </span><span class="a-text-bold">Mon, Nov 2</span></span></div><div class="a-row"><span class="a-color-base">Ships to India</span></div></div>
            <div class="a-button"><span class="a-button-inner"><a href="/Laptop-${i}/dp/B0000000${i}/ref=sr_1_${i}_so">See options</a></span></div>
          </div>
        </div>`;
    const page = `<div class="s-main-slot s-result-list">
        <div class="s-widget"><h2 class="a-size-medium-plus">Results</h2></div>
        ${card(1, { badge: 'Top Brand', bought: '500+ bought in past month' })}
        ${card(2, { list: '$325.99', bought: '50+ bought in past month' })}
        <div class="s-widget"><span class="video-ad"><a href="https://aax.amazon.com/x"><video></video><img src="https://aax.amazon.com/v.jpg"></a><span>Sponsored</span><span>Debug info copied.</span><h2><span>Video laptop</span></h2></span></div>
        ${card(3, { bought: '1K+ bought in past month' })}
        ${card(4, { list: '$3,799.99' })}
        ${card(5, { badge: 'Overall Pick', bought: '100+ bought in past month' })}
        ${card(6, {})}
        <div class="s-widget"><h2 class="a-size-medium-plus">Related searches</h2><a href="/s?k=gaming+laptop">gaming laptop</a><a href="/s?k=macbook">macbook</a></div>
        <div class="s-widget"><h2>Need help?</h2><a href="/help">Visit the help section</a></div>
    </div>`;

    it('reads only the product cards, with one plain column per field', () => {
        const rows = rowsOf(page, '.s-main-slot > div');
        const { columns, problems } = inferFields(rows);
        expect(columns.map(c => c.name)).toEqual(['Image', 'URL', 'Badge', 'Title', 'Rating', 'Reviews', 'Sales Volume', 'Price', 'Delivery Price', 'Was Price']);
        expect(problems[0]).toMatch(/4 of 10 picked elements/);
        const items = rows.map(r => readRow(r, columns));
        expect(items.filter(i => Object.keys(i).length > 0)).toHaveLength(6);
        const id = (n: string) => columns.find(c => c.name === n)!.id;
        expect(items[2]).toMatchObject({ [id('Title')]: 'Laptop model 2 with 8GB RAM', [id('Price')]: '$299.99', [id('Was Price')]: '$325.99', [id('Reviews')]: '(74)', [id('Rating')]: '4.2 out of 5 stars' });
        expect(items[1][id('Badge')]).toBe('Top Brand');
        expect(items[3]).toEqual({}); // the video ad
        expect(items[9]).toEqual({}); // "Need help?"
    });
});

describe('repeated components', () => {
    // A hook repeated inside each card, in two places (a flag over the image, chips under the price),
    // its text split over spans, with a different set and order of chips per card.
    const chip = (text: string) => `<span data-qa="chip">${text.split('|').map(t => `<span class="t">${t}</span>`).join(' ')}</span>`;
    const tile = (i: number, flag: string | null, chips: string[]) => `<li class="tile">
        <div data-qa="media">${flag ? `<div class="flags">${chip(flag)}</div>` : ''}<img src="/i/${i}.jpg"></div>
        <a href="/p/${i}"><h3>Toy ${i}</h3></a>
        <div data-qa="offer"><div class="row">${chips.map(chip).join('')}</div></div>
    </li>`;
    const page = (tiles: string[]) => `<ul>${tiles.join('')}</ul>`;
    const first = page([
        tile(1, 'Best|seller', ['Free shipping,|arrives in 3+ days']),
        tile(2, null, ['Members|save', 'Shipping,|arrives today', 'Pickup|today']),
        tile(3, 'Flash|Deal', ['Members|save', 'Courier|in 12 mins', 'Shipping,|arrives tomorrow', 'Pickup|as soon as 9am']),
        tile(4, null, ['Courier|in 30 mins', 'Free shipping,|arrives Tue, Oct 20', 'Low|stock']),
        tile(5, 'Clearance', ['Members|save', 'Shipping,|arrives today', 'Low|stock']),
    ]);

    it('gives each place and each kind of phrase its own column, whatever the order and the set per card', () => {
        const rows = rowsOf(first, '.tile');
        const { columns } = inferFields(rows);
        const names = columns.map(c => c.name);
        expect(names).toEqual(expect.arrayContaining(['Members Save', 'Courier', 'Shipping', 'Pickup', 'Low Stock']));
        const items = rows.map(r => readRow(r, columns));
        const id = (n: string) => columns.find(c => c.name === n)!.id;
        const flag = columns.find(c => items[0][c.id] === 'Best seller')!.id;
        expect(items.map(i => i[flag])).toEqual(['Best seller', undefined, 'Flash Deal', undefined, 'Clearance']);
        expect(items[2]).toMatchObject({ [id('Members Save')]: 'Members save', [id('Courier')]: 'Courier in 12 mins', [id('Shipping')]: 'Shipping, arrives tomorrow', [id('Pickup')]: 'Pickup as soon as 9am' });
        expect(items[3]).toMatchObject({ [id('Courier')]: 'Courier in 30 mins', [id('Shipping')]: 'Free shipping, arrives Tue, Oct 20', [id('Low Stock')]: 'Low stock' });
        // Never two phrases glued into one cell.
        items.forEach(i => Object.values(i).forEach(v => expect(v).not.toContain('; ')));

        // A later page: other cards, other orders, read into the same columns.
        const later = rowsOf(page([tile(9, 'Overall|pick', ['Pickup|today', 'Members|save', 'Free shipping,|arrives in 2 days'])]), '.tile');
        expect(readRow(later[0], columns)).toMatchObject({
            [flag]: 'Overall pick', [id('Pickup')]: 'Pickup today', [id('Members Save')]: 'Members save', [id('Shipping')]: 'Free shipping, arrives in 2 days',
        });
    });

    it('splits Walmart search tiles into a flag, save, shipping, delivery and pickup column (walmart.com/search?q=cars)', () => {
        loadPage('corpus/walmart-search.html.gz');
        const rows = Array.from(document.querySelector('[data-testid="item-stack"]')!.children);
        const { columns } = inferFields(rows);
        const items = rows.map(r => readRow(r, columns));
        const col = (n: string) => columns.find(c => c.name === n)!.id;
        const badges = ['Badge Tag', 'Save', 'Shipping', 'Delivery', 'Pickup Today'].map(col);
        items.forEach(i => badges.forEach(b => expect(i[b] ?? '').not.toMatch(/; /)));
        expect(items[0]).toMatchObject({ [col('Badge Tag')]: 'Reduced price', [col('Shipping')]: 'Free shipping, arrives in 3+ days' });
        expect(items[4]).toMatchObject({
            [col('Badge Tag')]: 'Overall pick', [col('Save')]: 'Save with', [col('Delivery')]: 'Delivery as soon as 13 mins',
            [col('Shipping')]: 'Shipping, arrives today', [col('Pickup Today')]: 'Pickup today',
        });
        expect(items[9]).toMatchObject({ [col('Badge Tag')]: "In 1K+ people's carts", [col('Save')]: 'Save with', [col('Delivery')]: 'Delivery as soon as 13 mins' });
        expect(items[9][col('Shipping')]).toBeUndefined();
    });
});

describe('table columns', () => {
    const table = (headers: string[], rows: string[][]) =>
        `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    it('reads each column by its header, so a page that adds a column still reads the right cells', () => {
        document.body.innerHTML = table(['Name', 'Price'], [['Lamp', '$5.00'], ['Desk', '$90.00'], ['Chair', '$40.00']]);
        const { columns } = inferFields(Array.from(document.querySelectorAll('tbody tr')));
        expect(columns.map(c => c.name)).toEqual(['Name', 'Price']);

        document.body.innerHTML = table(['Name', 'Stock', 'Price'], [['Sofa', 'In stock', '$300.00']]);
        const row = readRow(document.querySelector('tbody tr')!, columns);
        expect(row).toEqual({ [columns[0].id]: 'Sofa', [columns[1].id]: '$300.00' });

        document.body.innerHTML = table(['Name', 'Cost'], [['Rug', '$20.00']]);
        expect(readRow(document.querySelector('tbody tr')!, columns)).toEqual({ [columns[0].id]: 'Rug' });
    });
});
