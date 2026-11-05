import { describe, expect, it } from 'vitest';
import { isPlaceholderName, proposeFields, type PickedField } from './naming';

const pick = (extra: Partial<PickedField>): PickedField => ({ name: 'span', type: 'text', selectors: [], ...extra });

describe('field names from the pick', () => {
    it('knows a tag the picker named it after from a name someone gave', () => {
        expect(['h1', 'p', 'SPAN', '', 'New Element'].every(isPlaceholderName)).toBe(true);
        expect(['title', 'price', 'p_price'].some(isPlaceholderName)).toBe(false);
    });

    it('names from the page\'s data first', () => {
        const [title, price, brand, currency] = proposeFields([
            pick({ name: 'h1', data: { kind: 'ld', label: 'JSON-LD', nth: 0, type: 'Product', path: [], key: 'name', as: 'text' } }),
            pick({ name: 'p', data: { kind: 'ld', label: 'JSON-LD', nth: 0, path: ['offers'], key: 'price', as: 'text' } }),
            pick({ data: { kind: 'ld', label: 'JSON-LD', nth: 0, path: ['brand', 'name'], as: 'text' } }),
            pick({ data: { kind: 'json', label: '__NEXT_DATA__', nth: 0, path: ['product', 'priceCurrency'], as: 'text' } }),
        ], ['text', 'text', 'text', 'text']);
        expect(title).toMatchObject({ name: 'title', why: 'the page\'s data: name' });
        expect(price).toMatchObject({ name: 'price', type: 'money' });
        expect(brand.name).toBe('brand');
        expect(currency.name).toBe('currency');
    });

    it('then from the words in its selector, the specific before the general', () => {
        const names = proposeFields([
            pick({ selectors: ['span.product-price__was'] }),
            pick({ selectors: ['span.sale-price'] }),
            pick({ selectors: ['#sku-value'] }),
            pick({ selectors: ['[itemprop="brand"]'] }),
            pick({ selectors: ['div.rating-count'] }),
            pick({ selectors: ['div.stars'] }),
        ], Array(6).fill('text')).map(p => [p.name, p.type]);
        expect(names).toEqual([['was_price', 'money'], ['price', 'money'], ['sku', 'text'], ['brand', 'text'], ['review_count', 'integer'], ['rating', 'number']]);
    });

    it('then from its value or tag, and keeps names unique', () => {
        const names = proposeFields([
            pick({ name: 'h1', selectors: ['h1'], value: 'Linen Overshirt' }),
            pick({ name: 'p', selectors: ['p:nth-child(3)'], value: '$79.00' }),
            pick({ name: 'p', selectors: ['p:nth-child(4)'], value: '£12.50' }),
            pick({ name: 'img', type: 'image', selectors: ['img'] }),
            pick({ name: 'time', selectors: ['time'], value: '2026-11-05' }),
            pick({ name: 'p', selectors: ['p.x'], value: 'Relaxed overshirt in washed linen, with a camp collar, two chest pockets and horn buttons. Made in Portugal from European flax.' }),
        ], Array(6).fill('text')).map(p => [p.name, p.type]);
        expect(names).toEqual([['title', 'text'], ['price', 'money'], ['price_2', 'money'], ['image', 'url'], ['date', 'date'], ['description', 'text']]);
    });

    it('keeps the names someone gave, and their types', () => {
        const [kept, proposed] = proposeFields([pick({ name: 'price', selectors: ['.p'] }), pick({ name: 'p', selectors: ['.price'] })], ['text', 'text']);
        expect(kept).toEqual({ name: 'price', type: 'text', why: 'given' });
        expect(proposed.name).toBe('price_2');
    });
});
