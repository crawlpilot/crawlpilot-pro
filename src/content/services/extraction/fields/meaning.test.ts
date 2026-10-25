import { describe, it, expect } from 'vitest';
import { inferFields, readRow } from '.';
import { readValue } from '../atoms';
import { typedValue } from './parse';

function read(html: string) {
    document.body.innerHTML = `<ul>${html}</ul>`;
    const rows = Array.from(document.querySelectorAll('.card'));
    const { columns } = inferFields(rows);
    const items = rows.map(r => readRow(r, columns));
    const col = (name: string) => columns.find(c => c.name === name)?.id ?? `no column ${name}`;
    return { columns, names: columns.map(c => c.name), items, col };
}

const counts = ['12,345', '987', '4,520', '61,002'];
const approx = ['(12.3K)', '(987)', '(4.5K)', '(61K)'];

describe('meanings (GS4, GS5)', () => {
    it('keeps the exact count over the rounded one, and the rating over the star label', () => {
        const { names, items, col } = read(counts.map((c, i) => `<li class="card"><h3>Lamp ${i}</h3>
            <span data-qa="stars">${['4.5', '4', '3.5', '5'][i]}</span><span data-qa="rating">${['4.4', '4.1', '3.6', '4.8'][i]}</span>
            <span class="count">${approx[i]}</span><span class="exact">${c} ratings</span></li>`).join(''));
        expect(names.filter(n => n === 'Review Count' || n.startsWith('Review Count '))).toEqual(['Review Count']);
        expect(names.filter(n => n.startsWith('Rating'))).toEqual(['Rating']);
        expect(items.map(i => i[col('Review Count')])).toEqual(['12345', '987', '4520', '61002']);
        expect(items.map(i => i[col('Rating')])).toEqual(['4.4', '4.1', '3.6', '4.8']);
    });

    it('reads one price column from the plain and the sale layout of a card, typed', () => {
        const { names, items, col } = read([1, 2, 3, 4].map(i => `<li class="card"><a href="/p/${i}"><img src="/i/${i}.jpg"></a><h3>Lamp ${i}</h3>
            <span class="by">Acme ${i}</span><div data-qa="price-block">${i % 2
            ? `<span data-qa="reduced-price"><b>Now</b> $${i}9.00</span><s>$${i}9.99</s>`
            : `<span data-qa="main-price">$${i}5.00</span>`}</div></li>`).join(''));
        expect(names.filter(n => n.startsWith('Price'))).toEqual(['Price']);
        expect(items.map(i => i[col('Price')])).toEqual(['$19.00', '$25.00', '$39.00', '$45.00']);
    });

    it('names a field by the caption always right before it, and lists badges from several places', () => {
        const { names, items, col } = read([1, 2, 3, 4, 5].map(i => `<li class="card"><h3>Lamp ${i}</h3><span class="p">$${i}0.00</span>
            ${i <= 2 ? `<span data-qa="flag">${i === 1 ? 'Best seller' : 'Deal'}</span>` : ''}${i >= 2 && i <= 3 ? '<span data-qa="tag">Ad</span>' : ''}
            ${i >= 4 ? `<div data-qa="offer"><span>More choices</span><span>$${i}1.50</span></div>` : ''}</li>`).join(''));
        expect(names).toContain('More Choices Price');
        expect(names.join()).not.toMatch(/Badge \d|Text/);
        expect(items[3][col('More Choices Price')]).toBe('$41.50');
        expect(items[1][col('Badges')]).toBe('Deal; Ad');
    });
});

describe('build-time checks (L6)', () => {
    it('warns about an ID that repeats and a price that does not read as one', () => {
        document.body.innerHTML = `<ul>${[1, 2, 3, 4].map(i => `<li class="card" data-product-id="P${i % 2}"><h3>Lamp ${i}</h3>
            <span class="price">${i === 4 ? 'See price in cart' : `$${i}9.00`}</span><span class="price">${i === 3 ? 'Call us' : `$${i}5.00`}</span></li>`).join('')}</ul>`;
        const { problems } = inferFields(Array.from(document.querySelectorAll('.card')));
        expect(problems).toEqual(expect.arrayContaining([expect.stringMatching(/^ID check: “Product ID” repeats; 2 of 4 rows/)]));
        expect(problems.some(p => /^Number check: “Price.*” reads as a price in only 75% of rows/.test(p))).toBe(true);
    });
});

describe('typed and cleaned values (GS4)', () => {
    it('writes numbers and prices plainly, and keeps what does not parse', () => {
        expect(typedValue('1,064', 'number')).toBe('1064');
        expect(typedValue('(27.9K)', 'number')).toBe('27900');
        expect(typedValue('4.5 out of 5', 'number')).toBe('4.5 out of 5');
        expect(typedValue('Now $1,299.00', 'price')).toBe('$1,299.00');
        expect(typedValue('Typical: $47.99', 'price')).toBe('$47.99');
        expect(typedValue('See price in cart', 'price')).toBe('See price in cart');
    });

    it('unwraps a same-site click tracker and drops zero-width characters', () => {
        document.body.innerHTML = `<a id="t" href="https://shop.example.com/sp/track?bt=1&rd=https%3A%2F%2Fwww.example.com%2Fip%2Flamp%2F42&pos=3">x</a>
            <a id="r" href="/sspa/click?ie=UTF8&url=%2FLamp%2Fdp%2FB0X%2Fref%3Dsr_1">y</a>
            <a id="o" href="https://www.example.com/out?url=https%3A%2F%2Fother.org%2Fpage">z</a>
            <span id="z">300-​Piece Set</span>`;
        const el = (id: string) => document.getElementById(id)!;
        expect(readValue(el('t'), 'href')).toBe('https://www.example.com/ip/lamp/42');
        expect(readValue(el('r'), 'href')).toBe(`${location.origin}/Lamp/dp/B0X/ref=sr_1`);
        expect(readValue(el('o'), 'href')).toBe('https://www.example.com/out?url=https%3A%2F%2Fother.org%2Fpage');
        expect(readValue(el('z'), 'text')).toBe('300-Piece Set');
    });
});
