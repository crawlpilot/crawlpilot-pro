import { describe, it, expect, beforeEach } from 'vitest';
import { inferFields, readRow, hasReaders, unmappedCount } from '.';
import { alignToTemplate, atomText, collectAtoms, isAtomRoot, labelValue, readValue } from '../atoms';
import { applyDerive } from './split';
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
        // The rating is the number in "2.0 out of 5 stars" (`fields/split.ts`), typed (`fields/parse.ts`).
        expect(last[rating.id]).toBe('2');
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
        expect(inferFields(rows).columns.map(c => c.name)).toEqual(['Title', 'SKU']);
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
        expect(columns.map(c => c.name)).toEqual(['Image', 'ASIN', 'URL', 'Badge', 'Title', 'Rating', 'Review Count', 'Sales Volume', 'Price', 'Delivery Price', 'Was Price']);
        expect(problems[0]).toMatch(/4 of 10 picked elements/);
        const items = rows.map(r => readRow(r, columns));
        expect(items.filter(i => Object.keys(i).length > 0)).toHaveLength(6);
        const id = (n: string) => columns.find(c => c.name === n)!.id;
        expect(items[2]).toMatchObject({ [id('Title')]: 'Laptop model 2 with 8GB RAM', [id('Price')]: '$299.99', [id('Was Price')]: '$325.99', [id('Review Count')]: '74', [id('Rating')]: '4.2' });
        expect(items[1][id('Badge')]).toBe('Top Brand');
        expect(items[3]).toEqual({}); // the video ad
        expect(items[9]).toEqual({}); // "Need help?"
    });
});

describe('repeated components', { timeout: 30_000 }, () => {
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
        const kinds = ['Save', 'Shipping', 'Delivery', 'Pickup Today'].map(col);
        items.forEach(i => kinds.forEach(b => expect(i[b] ?? '').not.toMatch(/; /)));
        // The flag over the image and the "Sponsored" tag are badges: one list.
        const badges = (i: Record<string, string>) => (i[col('Badges')] ?? '').split('; ');
        expect(badges(items[0])).toContain('Reduced price');
        expect(items[0]).toMatchObject({ [col('Shipping')]: 'Free shipping, arrives in 3+ days' });
        expect(badges(items[4])).toContain('Overall pick');
        expect(items[4]).toMatchObject({
            [col('Save')]: 'Save with', [col('Delivery')]: 'Delivery as soon as 13 mins',
            [col('Shipping')]: 'Shipping, arrives today', [col('Pickup Today')]: 'Pickup today',
        });
        expect(badges(items[9])).toContain("In 1K+ people's carts");
        expect(items[9]).toMatchObject({ [col('Save')]: 'Save with', [col('Delivery')]: 'Delivery as soon as 13 mins' });
        expect(items[9][col('Shipping')]).toBeUndefined();
    });
});

describe('unique column selectors', { timeout: 30_000 }, () => {
    // A value in a plain span (no hook, no naming class) beside sibling spans that carry their own hooks, and
    // that only some cards have: `div > span` would read whichever comes first.
    const tile = (i: number, o: { range?: boolean; reviews?: boolean }) => `<li class="tile">
        <a href="/p/${i}"><h3>Thing ${i}</h3></a>
        <div><span data-qa="price">$${i}9.99</span>${o.range ? `<span data-qa="range">Options from $${i}9.99 – $${i + 1}9.99</span>` : ''}${o.reviews ? `<span data-qa="count">${i * 7}</span>` : ''}<span>4.${i} out of 5 stars. ${i * 7} reviews</span></div>
    </li>`;
    const list = `<ul>${[tile(1, { reviews: true }), tile(2, { range: true }), tile(3, {}), tile(4, { range: true, reviews: true }), tile(5, { reviews: true })].join('')}</ul>`;

    it('reads one element per column, never a sibling under the same path', () => {
        const rows = rowsOf(list, '.tile');
        const { columns } = inferFields(rows);
        const items = rows.map(r => readRow(r, columns));
        // "4.1 out of 5 stars. 7 reviews" is two fields (`fields/split.ts`).
        const rating = columns.find(c => c.name === 'Rating')!;
        const count = columns.find(c => c.name === 'Review Count')!;
        expect(items.map(i => i[rating.id])).toEqual([1, 2, 3, 4, 5].map(i => `4.${i}`));
        expect(items.map(i => i[count.id])).toEqual([1, 2, 3, 4, 5].map(i => `${i * 7}`));
        // On a later page with a sibling hook never seen before, still the same element.
        const later = rowsOf(`<ul><li class="tile"><a href="/p/9"><h3>Thing 9</h3></a><div><span data-qa="promo">Rollback</span><span data-qa="price">$9.99</span><span>4.9 out of 5 stars. 63 reviews</span></div></li></ul>`, '.tile');
        expect(readRow(later[0], columns)).toMatchObject({ [rating.id]: '4.9', [count.id]: '63' });
    });

    it('reads the rating and review count from the Walmart rating sentence (walmart.com/search?q=cars)', () => {
        loadPage('corpus/walmart-search.html.gz');
        const rows = Array.from(document.querySelector('[data-testid="item-stack"]')!.children);
        const { columns } = inferFields(rows);
        const items = rows.map(r => readRow(r, columns)).filter(i => Object.keys(i).length > 0);
        // The sentence "4.3 out of 5 Stars. 9 reviews" gives the rating and the review count of every card.
        const rating = columns.find(c => c.name === 'Rating')!.id;
        const count = columns.find(c => c.name === 'Review Count')!.id;
        items.forEach(i => { expect(i[rating]).toMatch(/^\d(\.\d)?$/); expect(i[count]).toMatch(/^\d+$/); });
        // No two columns read the same thing through the same selector unless they split it by slot, kind or part.
        const plain = columns.filter(c => c.reader!.slot === undefined && c.reader!.kind === undefined)
            .map(c => `${c.reader!.chain[0]}@${c.reader!.attr}${c.reader!.derive ? JSON.stringify(c.reader!.derive) : ''}`);
        expect(new Set(plain).size).toBe(plain.length);
    });
});

describe('Amazon category results (amazon.com/s?i=specialty-aps&bbn=16225005011, baby activity & entertainment)', { timeout: 30_000 }, () => {
    const load = () => {
        loadPage('corpus/amazon-category.html.gz');
        const rows = Array.from(document.querySelector('.s-main-slot')!.children);
        const { columns } = inferFields(rows);
        const items = rows.map(r => readRow(r, columns));
        const col = (n: string) => columns.find(c => c.name === n)?.id;
        const values = (n: string) => items.map(i => i[col(n)!]).filter(Boolean);
        return { columns, items, col, values };
    };

    it('reads the swatches as one list, not a column per position', () => {
        const { columns, values } = load();
        const swatches = columns.filter(c => c.reader!.chain[0] === 'div[role="listitem"] > a');
        // Their names as one text list, their links to each variant as one link list.
        expect(swatches.map(c => c.type).sort()).toEqual(['link_array', 'text_array']);
        expect(values('Options')).toContain('Beige; Black; Light Grey');
    });

    it('keeps unrelated values that never meet apart (rating digit vs "+2" swatch overflow)', () => {
        const { columns, items } = load();
        for (const c of columns) {
            const vs = items.map(i => i[c.id]).filter(Boolean);
            if (vs.some(v => /^\+\d+$/.test(v))) expect(vs.every(v => /^\+\d+$/.test(v))).toBe(true);
        }
    });

    it('has no button captions or screen-reader filler, and names delivery and ratings', () => {
        const { columns, items, values } = load();
        const all = items.flatMap(i => Object.values(i));
        for (const junk of ['See options', 'Add to cart', 'Price, product page']) expect(all).not.toContain(junk);
        expect(columns.map(c => c.name)).toEqual(expect.arrayContaining(['Title', 'Rating', 'Review Count', 'Sales Volume', 'Price', 'Was Price', 'Delivery', 'Options']));
        // Typed: "4.0 out of 5 stars" is 4.
        expect(values('Rating').every(v => /^\d(\.\d)?$/.test(v))).toBe(true);
        expect(values('Delivery').every(v => /delivery/.test(v))).toBe(true);
        expect(columns.map(c => c.name).join()).not.toMatch(/Nowrap|Platinum|Column|Button/);
    });
});

describe('lists', { timeout: 30_000 }, () => {
    // A gallery whose slides carry their position in the hook (`gallery-image-0` … `-N`), a
    // different number per card.
    const tile = (i: number, slides: number) => `<li class="tile">
        <div data-qa="gallery">${Array.from({ length: slides }, (_, k) => `<div class="slide"><img data-qa="gallery-image-${k}" src="/p${i}/${k}.jpg"></div>`).join('')}</div>
        <a href="/p/${i}"><h3>Shirt ${i}</h3></a><span data-qa="price">$${i}9</span>
    </li>`;
    const page = (counts: number[]) => `<ul>${counts.map((n, i) => tile(i + 1, n)).join('')}</ul>`;

    it('reads indexed slides as one image list plus the main image, never a column per position', () => {
        const rows = rowsOf(page([3, 5, 2, 4]), '.tile');
        const { columns } = inferFields(rows);
        const images = columns.filter(c => c.type === 'image' || c.type === 'image_array');
        expect(images.map(c => [c.name, c.type])).toEqual([['Image', 'image'], ['Images', 'image_array']]);
        const item = readRow(rows[1], columns);
        expect(item[images[0].id]).toBe('http://localhost:3000/p2/0.jpg');
        expect(JSON.parse(item[images[1].id])).toEqual([0, 1, 2, 3, 4].map(k => `http://localhost:3000/p2/${k}.jpg`));
        // A later card with more slides than any sampled one still reads them all.
        const later = rowsOf(page([9]), '.tile');
        expect(JSON.parse(readRow(later[0], columns)[images[1].id])).toHaveLength(9);
    });

    it('keeps a fixed set of same-kind siblings as one column each', () => {
        const rows = rowsOf(`<ul>${[1, 2, 3, 4].map(i => `<li class="card"><h3>Lamp ${i}</h3><span class="meta">Acme ${i}</span><span class="meta">Blue ${i}</span><span class="meta">Large ${i}</span></li>`).join('')}</ul>`);
        const { columns } = inferFields(rows);
        expect(columns.filter(c => c.reader!.slot !== undefined)).toHaveLength(3);
        expect(columns.some(c => c.reader!.many)).toBe(false);
    });

    it('reads COS product galleries as Image + Images (cos.com/en-us/search?search=shirts)', () => {
        loadPage('corpus/cos-search.html.gz');
        const rows = Array.from(document.querySelector('[data-testid="product-card-wrapper"]')!.parentElement!.parentElement!.children);
        const { columns } = inferFields(rows);
        const images = columns.filter(c => c.type === 'image' || c.type === 'image_array');
        expect(images.map(c => c.name)).toEqual(['Image', 'Images']);
        rows.forEach(row => {
            const item = readRow(row, columns);
            const slides = Array.from(row.querySelectorAll('[data-testid^="default-product-card-slider-image-"]')).map(el => readValue(el, 'src'));
            expect(item[images[0].id]).toBe(slides[0]);
            expect(JSON.parse(item[images[1].id])).toEqual([...new Set(slides)]);
        });
        expect(columns.map(c => c.name)).toEqual(expect.arrayContaining(['URL', 'Title', 'Price']));
    });
});

describe('a column reads one element per card', () => {
    // On real pages: a plain column's selector matches at most one element that reads a value in
    // each card, so a run can't read a sibling the inference never meant.
    const pages: [string, string, string][] = [
        ['corpus/walmart-search.html.gz', '[data-testid="item-stack"]', 'walmart'],
        ['corpus/amazon-search.html.gz', '.s-main-slot', 'amazon search'],
        ['corpus/amazon-category.html.gz', '.s-main-slot', 'amazon category'],
        ['corpus/cos-search.html.gz', ':has(> div > [data-testid="product-card-wrapper"])', 'cos'],
    ];
    it.each(pages)('%s', (file, container) => {
        loadPage(file);
        const rows = Array.from(document.querySelector(container)!.children);
        const { columns } = inferFields(rows);
        // Only item cards: headers, widgets and ads read as {} anyway.
        const items = rows.filter(row => Object.keys(readRow(row, columns)).length > 0);
        expect(items.length).toBeGreaterThan(5);
        for (const c of columns) {
            const r = c.reader!;
            // Lists, slots, kinds and label/value pairs read several elements on purpose.
            if (r.many || r.first || r.slot !== undefined || r.kind !== undefined || r.json || r.cell || (r.derive && 'pair' in r.derive)) continue;
            const raw = (el: Element) => (r.attr === 'aria-label' || r.attr === 'title' ? labelValue(el, r.attr) : readValue(el, r.attr));
            // A derived part reads the element whose value fits its template.
            const value = (el: Element) => (r.derive ? applyDerive(raw(el), r.derive) ?? '' : raw(el));
            for (const row of items) {
                const reads = Array.from(row.querySelectorAll(r.chain[0]))
                    .filter(el => isAtomRoot(el, row, r.attr) && value(el) !== '');
                expect(reads.length, `${c.name} ← ${r.chain[0]}`).toBeLessThanOrEqual(1);
            }
        }
    }, 30_000);
});

describe('BestBuy price blocks (bestbuy.com TV search, prices loaded)', () => {
    const sr = (t: string) => `<span class="sr-only">${t}</span>`;
    const price = (p: string) => { const [w, c] = p.split('.'); return `<div data-testid="price-block-customer-price">${sr('$' + p)}<span aria-hidden="true">$</span><span aria-hidden="true">${w}</span><span aria-hidden="true">${c}</span></div>`; };
    const bbCard = (o: { brand: string; rest: string; price: string; save?: string; was?: string; deal?: boolean; sku: string }) => `
    <li class="product-list-item grid-view"><div class="sku-block">
     <div class="product-image"><a href="/product/${o.sku}"><img data-testid="product-image" src="/i/${o.sku}.jpg"></a></div>
     <div class="sku-block-content-title"><a class="product-list-item-link" href="/product/${o.sku}"><h3 class="product-title"><span class="first-title">${o.brand}</span><span> - ${o.rest}</span></h3></a></div>
     <div class="ratings"><a data-testid="rnr-stats-link" href="/product/${o.sku}#r"><div class="c-ratings-reviews"><p class="visually-hidden">Rating 4.6 out of 5 stars with 22 reviews</p><span aria-hidden="true" class="font-weight-bold">4.6</span><span aria-hidden="true" class="c-reviews">(22 reviews)</span></div></a></div>
     <div class="pricing"><div data-testid="bestbuy-price-ui-price-experience"><div data-testid="MEDIUM_profile">
      <div data-testid="price-block"><div data-testid="MEDIUM_profile"><div data-testid="price-block-content"><div data-testid="price-block-column">
       ${o.deal ? `<div data-testid="price-block-badging"><span class="sr-only">Top Deal</span><span aria-hidden="true">Top Deal</span></div>` : ''}
       ${price(o.price)}
       <div data-testid="price-block-savings">${o.save ? `<div data-testid="price-block-total-savings"><span>Save $${o.save}</span></div>` : ''}${o.was ? `<div data-testid="price-block-regular-price"><div role="text">${sr('The comparable value is ')}<span style="text-decoration-line: line-through"><span style="text-decoration-line: line-through">$${o.was}</span></span></div></div>` : ''}</div>
      </div></div><div data-testid="price-block-footer"></div></div></div>
      <div data-testid="plus-x-offers"><button aria-label="Plus 3 offers for you"><span>+ 3 offers for you</span></button></div>
     </div></div></div>
     <div class="fulfillment"><p><span>Pick up today</span></p><p><span>Shipping unavailable</span></p></div>
    </div></li>`;


    it('reads the price, savings and comparable value, not the price block whole; the title whole', () => {
        document.body.innerHTML = '<ul>' + [
        bbCard({ brand: 'LG', rest: '50” Class NU700B Series TV', price: '249.99', save: '80', was: '329.99', sku: '6675545' }),
        bbCard({ brand: 'Insignia™', rest: '50" Class F50 Series Fire TV', price: '179.99', save: '120', was: '299.99', deal: true, sku: '6607830' }),
        bbCard({ brand: 'Insignia™', rest: '55" Class QF Series Fire TV', price: '229.99', save: '170', was: '399.99', sku: '6616640' }),
        bbCard({ brand: 'LG', rest: '43” Class NU700B Series TV', price: '199.99', save: '50', was: '249.99', sku: '6675538' }),
        bbCard({ brand: 'LG', rest: '75" Class 7S Series QNED TV', price: '499.99', save: '180', was: '679.99', sku: '6675543' }),
        bbCard({ brand: 'Samsung', rest: '65" Class DU7200 TV', price: '399.99', sku: '6576415' }),
        bbCard({ brand: 'TCL', rest: '55" Class S5 Series TV', price: '299.99', save: '30', was: '329.99', sku: '6576416' }),
        bbCard({ brand: 'Sony', rest: '65" Class BRAVIA 3 TV', price: '599.99', sku: '6576417' }),
        bbCard({ brand: 'Hisense', rest: '58" Class A6 Series TV', price: '279.99', save: '20', was: '299.99', sku: '6576418' }),
        ].join('') + '</ul>';
        const rows = Array.from(document.querySelectorAll('li'));
        const { columns } = inferFields(rows);
        const byName = (n: string) => columns.find(c => c.name === n)?.id;
        expect(columns.map(c => c.name)).toEqual(expect.arrayContaining(['Title', 'Price', 'Savings', 'Was Price']));
        expect(columns.map(c => c.name)).not.toContain('Offers');
        const lg = readRow(rows[0], columns);
        expect(lg[byName('Title')!]).toBe('LG - 50” Class NU700B Series TV');
        expect(lg[byName('Price')!]).toBe('$249.99');
        expect(lg[byName('Was Price')!]).toBe('$329.99');
        expect(readRow(rows[1], columns)[byName('Price')!]).toBe('$179.99');
    });
});

describe('Google Maps results (google.com/maps/search/cars, Bangalore)', () => {
    const dot = '<span aria-hidden="true">·</span>';
    const row = (o: { name: string; rating?: string; reviews?: string; kind: string; addr?: string; open?: string; phone?: string }) => `
    <div role="article" class="Nv2PK" aria-label="${o.name}"><a class="hfpxzc" href="/maps/place/${encodeURIComponent(o.name)}" aria-label="${o.name}"></a>
     <div class="bfdHYd"><div class="lI9IFe"><div class="y7PRA"><div><div class="Lui3Od"><div class="NrDZNb"><div class="qBF1Pd fontHeadlineSmall">${o.name}</div></div>
      <div class="W4Efsd">${o.rating ? `<span class="e4rVHe fontBodyMedium"><span role="img" class="ZkP5Je" aria-label="${o.rating} stars ${o.reviews} Reviews"><span class="MW4etd" aria-hidden="true">${o.rating}</span><span class="UY7F9" aria-hidden="true">(${o.reviews})</span></span></span>` : '<span class="e4rVHe fontBodyMedium">No reviews</span>'}</div>
      <div class="W4Efsd"><div class="W4Efsd"><span><span>${o.kind}</span></span><span>${dot}<span></span></span>${o.addr ? `<span>${dot}<span>${o.addr}</span></span>` : ''}</div>
       <div class="W4Efsd">${o.open ? `<span><span><span style="color:green">${o.open.split(' ⋅ ')[0]}</span>${o.open.includes(' ⋅ ') ? `<span style="font-weight:400"> ⋅ ${o.open.split(' ⋅ ')[1]}</span>` : ''}</span></span>` : ''}${o.phone ? `<span>${o.open ? dot : ''}<span class="UsdlK">${o.phone}</span></span>` : ''}</div></div>
     </div></div></div></div></div></div>`;

    it('reads the phone number whole into one Phone column, whatever its format and its place in the line', () => {
        document.body.innerHTML = '<div role="feed">' + [
                row({ name: 'Mahindra First Choice', rating: '4.5', reviews: '1,234', kind: 'Used car dealer', addr: 'Hennur Main Rd', open: 'Open 24 hours', phone: '080 4370 1234' }),
                row({ name: 'Spinny Car Hub', rating: '4.7', reviews: '5,012', kind: 'Used car dealer', addr: 'Outer Ring Rd', open: 'Open ⋅ Closes 8 pm', phone: '098455 12345' }),
                row({ name: 'Cars24', rating: '4.1', reviews: '320', kind: 'Car dealer', open: 'Closed ⋅ Opens 10 am', phone: '1800-258-5656' }),
                row({ name: 'Toyota Showroom', rating: '4.3', reviews: '890', kind: 'Toyota dealer', addr: 'Old Madras Rd', phone: '080 6767 6767' }),
                row({ name: 'Hyundai Motors', kind: 'Car dealer', addr: 'Banaswadi', open: 'Open ⋅ Closes 9 pm' }),
                row({ name: 'Maruti Arena', rating: '4.0', reviews: '2,101', kind: 'Car dealer', addr: 'HRBR Layout', open: 'Open ⋅ Closes 8 pm', phone: '+91 99019 14211' }),
                row({ name: 'Kia Motors', rating: '4.6', reviews: '77', kind: 'Kia dealer', open: 'Open 24 hours', phone: '06362570000' }),
            ].join('') + '</div>';
        const rows = Array.from(document.querySelectorAll('[role="article"]'));
        const { columns } = inferFields(rows);
        const phones = columns.filter(c => c.name === 'Phone');
        expect(phones).toHaveLength(1);
        expect(phones[0].type).toBe('text');
        expect(rows.map(r => readRow(r, columns)[phones[0].id])).toEqual(['080 4370 1234', '098455 12345', '1800-258-5656', '080 6767 6767', undefined, '+91 99019 14211', '06362570000']);
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
