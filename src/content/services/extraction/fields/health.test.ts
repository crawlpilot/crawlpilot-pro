import { describe, it, expect } from 'vitest';
import { checkPage, hasReaders, inferFields, isPending, readRow, readWhenReady } from '.';

/** A card: the price in `priceClass`, its reviews as "(N)". */
const card = (i: number, o: { priceClass?: string; cardClass?: string; noPrice?: boolean } = {}) => `<li class="${o.cardClass ?? 'card'}">
    <a href="/p/${i}"><img src="/i/${i}.jpg"></a><h3 class="${o.cardClass ? 'nm' : 'name'}">Lamp ${i}</h3>
    ${o.noPrice ? '' : `<span class="${o.priceClass ?? 'price'}">$${i}9.00</span>`}<span class="${o.cardClass ? 'rv' : 'reviews'}">(${i * 7})</span></li>`;

function page(cards: string[]): Element[] {
    document.body.innerHTML = `<ul>${cards.join('')}</ul>`;
    return Array.from(document.querySelectorAll('li'));
}

const first = () => inferFields(page([1, 2, 3, 4, 5].map(i => card(i)))).columns;
const priceOf = (columns: ReturnType<typeof first>) => columns.find(c => c.reader?.meaning === 'Price')!;

describe('field spec v3 (GS6)', () => {
    it('stores each field’s meaning and what it looked like', () => {
        const price = priceOf(first());
        expect(price.reader).toMatchObject({ v: 3, meaning: 'Price', expect: { fill: 1, parse: 1 } });
    });

    it('still reads version 2 readers, which carry neither', () => {
        const v2 = first().map(c => ({ ...c, reader: { ...c.reader!, v: 2 as const, meaning: undefined, expect: undefined } }));
        expect(hasReaders(v2)).toBe(true);
        const rows = page([card(8)]);
        expect(readRow(rows[0], v2)[priceOf(first()).id]).toBe('$89.00');
    });
});

describe('checks and heal (GS7)', () => {
    it('finds a field again by its meaning when its class was renamed, and keeps the old reader as a fallback', () => {
        const columns = first();
        const rows = page([6, 7, 8, 9].map(i => card(i, { priceClass: 'amount-x7f' })));
        const price = priceOf(columns);
        expect(readRow(rows[0], columns)[price.id]).toBeUndefined();
        const health = checkPage(rows, columns);
        expect(health).toMatchObject({ healed: ['Price'], broken: [] });
        const healed = priceOf(health.columns);
        expect(rows.map(r => readRow(r, health.columns)[healed.id])).toEqual(['$69.00', '$79.00', '$89.00', '$99.00']);
        // A page with the old layout still reads.
        const old = page([card(3)]);
        expect(readRow(old[0], health.columns)[healed.id]).toBe('$39.00');
    });

    it('leaves fields that still read alone', () => {
        const columns = first();
        const health = checkPage(page([6, 7, 8].map(i => card(i))), columns);
        expect(health.columns).toBe(columns);
    });

    it('re-reads every field when the cards were redesigned, row gate included', () => {
        const columns = first();
        const rows = page([6, 7, 8, 9].map(i => card(i, { cardClass: 'tile-2', priceClass: 'p-amt' })));
        const health = checkPage(rows, columns);
        // The title is read from its `h3`, which a class rename leaves alone.
        expect(health.healed).toEqual(['Price', 'Review Count']);
        const item = readRow(rows[1], health.columns);
        expect(item[priceOf(health.columns).id]).toBe('$79.00');
        expect(Object.values(item)).toContain('Lamp 7');
    });

    it('reports a field nothing on the page means', () => {
        const health = checkPage(page([6, 7, 8, 9].map(i => card(i, { noPrice: true }))), first());
        expect(health).toMatchObject({ healed: [], broken: ['Price'] });
    });
});

describe('readiness (GS7)', () => {
    it('tells a loading row from a loaded one', () => {
        const [skeleton, busy, wrapper] = page([
            '<li><div class="skeleton-line"></div></li>',
            '<li aria-busy="true"><h3>Lamp</h3></li>',
            '<li><div class="img-placeholder"><img src="/i/1.jpg"></div><h3>Lamp</h3></li>',
        ]);
        expect([isPending(skeleton), isPending(busy), isPending(wrapper)]).toEqual([true, true, false]);
    });

    it('treats an empty element where every card had a value as loading', () => {
        const columns = first();
        const [row] = page([card(1).replace('Lamp 1', '')]);
        expect(isPending(row, columns)).toBe(true);
    });

    it('reads a skeleton row again once it has loaded', async () => {
        const columns = first();
        const [row] = page([`<li class="card"><div class="shimmer"></div></li>`]);
        let settles = 0;
        const { item, pending } = await readWhenReady(row, columns, async () => {
            settles++;
            // The page loads the card in the meantime.
            row.innerHTML = card(4).replace(/^<li[^>]*>|<\/li>$/g, '');
        });
        expect(settles).toBe(1);
        expect(pending).toBe(false);
        expect(Object.values(item)).toEqual(expect.arrayContaining(['Lamp 4', '$49.00']));
    });
});
