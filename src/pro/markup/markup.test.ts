import { beforeEach, describe, expect, it } from 'vitest';
import { listMarkup, readMarkup, readMarkupFields } from './markup';

beforeEach(() => {
    document.head.innerHTML = `
        <meta name="viewport" content="width=device-width">
        <meta property="og:title" content="Linen overshirt">
        <meta property="product:price:amount" content="79.00">
        <meta property="product:price:currency" content="GBP">
        <meta name="twitter:data1" content="In stock">`;
    document.body.innerHTML = `
        <nav itemscope itemtype="https://schema.org/BreadcrumbList"><span itemprop="name">Shirts</span></nav>
        <div itemscope itemtype="https://schema.org/Product">
          <h1 itemprop="name">Linen overshirt – navy</h1>
          <meta itemprop="sku" content="LX-2041">
          <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
            <span itemprop="price" content="79.00">£79</span>
            <link itemprop="availability" href="https://schema.org/InStock">
          </div>
        </div>`;
});

describe('markup', () => {
    it('reads meta tags by property or name', () => {
        expect(readMarkup({ source: 'meta', key: 'og:title' })).toBe('Linen overshirt');
        expect(readMarkup({ source: 'meta', key: 'product:price:amount' })).toBe('79.00');
        expect(readMarkup({ source: 'meta', key: 'twitter:data1' })).toBe('In stock');
        expect(readMarkup({ source: 'meta', key: 'og:image' })).toBeUndefined();
    });

    it('reads microdata props by item type and a dotted path through nested items, content over text', () => {
        expect(readMarkup({ source: 'microdata', type: 'Product', key: 'name' })).toBe('Linen overshirt – navy');
        expect(readMarkup({ source: 'microdata', type: 'Product', key: 'offers.price' })).toBe('79.00');
        expect(readMarkup({ source: 'microdata', type: 'Product', key: 'offers.availability' })).toBe('https://schema.org/InStock');
        expect(readMarkup({ source: 'microdata', type: 'Product', key: 'sku' })).toBe('LX-2041');
        // The type tells items apart: the breadcrumb has a name too.
        expect(readMarkup({ source: 'microdata', type: 'BreadcrumbList', key: 'name' })).toBe('Shirts');
        expect(readMarkup({ source: 'microdata', type: 'Product', key: 'offers.priceCurrency' })).toBeUndefined();
    });

    it('takes a field\'s first markup way that reads', () => {
        expect(readMarkupFields([{ id: 'price', ways: [{ source: 'meta', key: 'og:price' }, { source: 'microdata', type: 'Product', key: 'offers.price' }] }]))
            .toEqual({ price: { value: '79.00', used: 1, matches: [false, true] } });
        expect(readMarkupFields([{ id: 'x', ways: [{ source: 'meta', key: 'nope' }] }])).toEqual({});
    });

    it('lists what the page has, for the editor, leaving out page plumbing', () => {
        const list = listMarkup();
        expect(list).toEqual(expect.arrayContaining([
            { source: 'meta', key: 'og:title', value: 'Linen overshirt' },
            { source: 'microdata', type: 'Product', key: 'offers.price', value: '79.00' },
            { source: 'microdata', type: 'Offer', key: 'price', value: '79.00' },
        ]));
        expect(list.some(e => e.key === 'viewport')).toBe(false);
    });
});
