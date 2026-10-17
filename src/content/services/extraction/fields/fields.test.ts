import { describe, it, expect, beforeEach } from 'vitest';
import { inferFields, readRow, hasReaders, unmappedCount } from '.';
import { alignToTemplate, atomText, collectAtoms } from '../atoms';

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
