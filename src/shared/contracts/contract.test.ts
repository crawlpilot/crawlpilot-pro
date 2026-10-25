import { describe, it, expect } from 'vitest';
import { autoMap, checkContract, contractFromFields, contractJsonSchema, convertValue, productIdFromUrl, RETAIL_LISTING, shapeRows } from './contract';
import { parseSchemaInput } from '../ai/schemaIntake';

// Columns as field-first inference names them on an Amazon search page.
const columns = [
    { id: 'image', name: 'Image', type: 'image' },
    { id: 'title', name: 'Title', type: 'text' },
    { id: 'url', name: 'URL', type: 'url' },
    { id: 'price', name: 'Price', type: 'price' },
    { id: 'was_price', name: 'Was Price', type: 'price' },
    { id: 'rating', name: 'Rating', type: 'number' },
    { id: 'reviews', name: 'Reviews', type: 'number' },
    { id: 'badge', name: 'Badge', type: 'text' },
    { id: 'sponsored', name: 'Sponsored', type: 'text' },
    { id: 'delivery', name: 'Delivery', type: 'text' },
];
const rows = [
    { image: 'https://m.media-amazon.com/a.jpg', title: 'Desk Lamp', url: 'https://www.amazon.com/Desk-Lamp/dp/B0ABCDEF12?utm_source=feed&keywords=lamp', price: '$24.99', was_price: '$29.99', rating: '4.5 out of 5 stars', reviews: '1,234', badge: 'Best Seller', sponsored: 'Sponsored', delivery: 'FREE delivery Tue' },
    { image: 'https://m.media-amazon.com/b.jpg', title: 'Floor Lamp', url: 'https://www.amazon.com/Floor-Lamp/dp/B0ZZZZZZ99', price: '$59.00', rating: '4.1 out of 5 stars', reviews: '87' },
    { title: 'Wall Light', url: 'https://www.amazon.com/dp/B011111111', price: '$15.50', rating: '3.9 out of 5 stars', reviews: '5K+' },
];

/** Minimal JSON Schema check for the shapes contractJsonSchema emits. */
function validates(schema: any, data: any[]): string[] {
    const errs: string[] = [];
    const item = schema.items;
    data.forEach((r, i) => {
        item.required.forEach((k: string) => { if (!(k in r)) errs.push(`${i}: missing ${k}`); });
        Object.entries(r).forEach(([k, v]) => {
            const p = item.properties[k];
            if (!p) { errs.push(`${i}: extra ${k}`); return; }
            const t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v === 'number' && Number.isInteger(v) && p.type === 'integer' ? 'integer' : typeof v;
            const want = p.type === 'integer' ? 'integer' : p.type;
            if (t !== want && !(want === 'number' && t === 'integer')) errs.push(`${i}: ${k} is ${t}, want ${want}`);
            if (p.minimum !== undefined && (v as number) < p.minimum) errs.push(`${i}: ${k} < min`);
            if (p.maximum !== undefined && (v as number) > p.maximum) errs.push(`${i}: ${k} > max`);
            if (p.type === 'object') p.required.forEach((rk: string) => { if (!((v as any)[rk] !== undefined)) errs.push(`${i}: ${k}.${rk} missing`); });
        });
    });
    return errs;
}

describe('retail listing contract', () => {
    it('maps inferred columns by name, type and values', () => {
        const m = autoMap(RETAIL_LISTING, columns, rows);
        expect(m).toMatchObject({
            title: 'title', url: 'url', image_url: 'image', price: 'price', list_price: 'was_price',
            rating: 'rating', reviews_count: 'reviews', badges: 'badge', sponsored: 'sponsored', shipping: 'delivery', product_id: null,
        });
    });

    it('shapes rows: money objects, counts, ratings, ids from URLs, clean URLs, defaults', () => {
        const m = autoMap(RETAIL_LISTING, columns, rows);
        const shaped = shapeRows(RETAIL_LISTING, m, rows);
        expect(shaped[0]).toMatchObject({
            position: 1, product_id: 'B0ABCDEF12', title: 'Desk Lamp',
            price: { amount: 24.99, currency: 'USD' }, list_price: { amount: 29.99, currency: 'USD' },
            rating: 4.5, reviews_count: 1234, sponsored: true, badges: ['Best Seller'],
        });
        expect(shaped[0].url).not.toMatch(/utm_source/);
        expect(shaped[2]).toMatchObject({ position: 3, product_id: 'B011111111', reviews_count: 5000, sponsored: false });
        expect(shaped[2].image_url).toBeUndefined();
    });

    it('passes the checks and validates against its JSON Schema', () => {
        const m = autoMap(RETAIL_LISTING, columns, rows);
        const shaped = shapeRows(RETAIL_LISTING, m, rows);
        const report = checkContract(RETAIL_LISTING, m, shaped);
        expect(report.unmappedRequired).toEqual([]);
        expect(report.invalidRows).toBe(0);
        expect(report.ok).toBe(true);
        expect(validates(contractJsonSchema(RETAIL_LISTING), shaped)).toEqual([]);
    });

    it('reports required fields with no column and fields under their floor', () => {
        const shaped = shapeRows(RETAIL_LISTING, { title: 'title' }, rows);
        const report = checkContract(RETAIL_LISTING, { title: 'title' }, shaped);
        expect(report.unmappedRequired).toEqual(expect.arrayContaining(['url', 'product_id']));
        expect(report.underFloor.map(u => u.name)).toEqual(expect.arrayContaining(['url', 'price']));
        expect(report.ok).toBe(false);
    });
});

describe('helpers', () => {
    it.each([
        ['https://www.amazon.com/x/dp/B0ABCDEF12?th=1', 'B0ABCDEF12'],
        ['https://www.walmart.com/ip/Sleep-Mattress/16655001628', '16655001628'],
        ['https://shop.test/product/lamp-42', 'lamp-42'],
        ['https://shop.test/about', undefined],
    ])('product id of %s', (url, id) => expect(productIdFromUrl(url)).toBe(id));

    it('converts by type and refuses what does not fit', () => {
        expect(convertValue({ name: 'p', type: 'money' }, 'free')).toBeUndefined();
        expect(convertValue({ name: 'i', type: 'image' }, '["https://a.test/1.jpg","https://a.test/2.jpg"]')).toBe('https://a.test/1.jpg');
        expect(convertValue({ name: 's', type: 'boolean' }, 'Free shipping')).toBeUndefined();
    });

    it('builds a contract from pasted fields', () => {
        const c = contractFromFields(parseSchemaInput('title\nprice\nrating\nlink: product url').fields);
        expect(c.fields.map(f => [f.name, f.type])).toEqual([['title', 'string'], ['price', 'money'], ['rating', 'rating'], ['link', 'url']]);
    });
});
