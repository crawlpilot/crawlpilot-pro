import { describe, it, expect } from 'vitest';
import { parseMoney, parseCount, parsePercent, parseRating, parseDate, cleanUrl, parseBoolean } from './parsers';
import { applyChain } from './chain';
import { detectType } from './detect';

describe('parseMoney', () => {
    it.each([
        ['$1,299.99', 1299.99, 'USD'],
        ['1.299,00 €', 1299, 'EUR'],
        ['£20', 20, 'GBP'],
        ['USD 15', 15, 'USD'],
        ['₹ 2,499', 2499, 'INR'],
        ['CA$ 30.50', 30.5, 'CAD'],
        ['19.99', 19.99, null],
    ] as const)('%s → %s %s', (s, amount, cur) => {
        const m = parseMoney(s)!;
        expect(m.amount).toBe(amount);
        expect(m.currency).toBe(cur);
    });
    it('reads ranges', () => {
        expect(parseMoney('From £20 – £35')).toEqual({ amount: 20, currency: 'GBP', upper: 35 });
    });
    it('returns null without a number', () => {
        expect(parseMoney('Free shipping')).toBeNull();
    });
});

describe('other parsers', () => {
    it('counts', () => {
        expect(parseCount('10K+ bought in past month')).toBe(10000);
        expect(parseCount('1.2M views')).toBe(1200000);
        expect(parseCount('3,456 ratings')).toBe(3456);
    });
    it('percent', () => {
        expect(parsePercent('-15% off')).toBe(-15);
        expect(parsePercent('12,5 %')).toBe(12.5);
        expect(parsePercent('15')).toBeUndefined();
    });
    it('rating', () => {
        expect(parseRating('4.5 out of 5 stars')).toBe(4.5);
        expect(parseRating('8/10')).toBe(4);
        expect(parseRating('4,2')).toBe(4.2);
        expect(parseRating('Rated 7')).toBeUndefined();
    });
    it('dates', () => {
        const now = new Date('2026-10-17T12:00:00Z');
        expect(parseDate('2024-01-05')).toBe('2024-01-05');
        expect(parseDate('2024-01-05T10:30:00Z')).toBe('2024-01-05T10:30:00');
        expect(parseDate('Jan 5th, 2024')).toBe('2024-01-05');
        expect(parseDate('5 January 2024')).toBe('2024-01-05');
        expect(parseDate('25/12/2024')).toBe('2024-12-25');
        expect(parseDate('03/04/2024')).toBe('2024-03-04');
        expect(parseDate('03/04/2024', { dayFirst: true })).toBe('2024-04-03');
        expect(parseDate('Reviewed in the United States on March 3, 2025')).toBe('2025-03-03');
        expect(parseDate('3 days ago', { now })).toBe('2026-10-14');
        expect(parseDate('yesterday', { now })).toBe('2026-10-16');
        expect(parseDate('31/02/2024')).toBeUndefined();
        expect(parseDate('hello')).toBeUndefined();
    });
    it('urls', () => {
        expect(cleanUrl('/p/1?utm_source=x&color=red#top', 'https://shop.com/c')).toBe('https://shop.com/p/1?color=red');
        expect(cleanUrl('javascript:void(0)')).toBeUndefined();
    });
    it('booleans', () => {
        expect(parseBoolean('In stock')).toBe(true);
        expect(parseBoolean('Sold out')).toBe(false);
        expect(parseBoolean('maybe')).toBeUndefined();
    });
});

describe('applyChain', () => {
    it('runs steps then parses, keeping each step for preview', () => {
        const r = applyChain('  Price: $1,299.00 (incl. VAT) ', 'money', [{ op: 'regex', pattern: 'Price:\\s*([^()]+)' }, { op: 'trim' }]);
        expect(r.value).toBe(1299);
        expect(r.currency).toBe('USD');
        expect(r.steps.map(s => s.value)).toEqual(['$1,299.00 ', '$1,299.00']);
    });
    it('split picks a part, negative index from the end', () => {
        expect(applyChain('Home > Kitchen > Lamps', 'text', [{ op: 'split', sep: '>', index: -1 }]).value).toBe('Lamps');
    });
    it('marks failures and passes empty through', () => {
        expect(applyChain('n/a', 'number', []).ok).toBe(false);
        expect(applyChain('', 'number', []).value).toBeNull();
    });
});

describe('detectType', () => {
    it.each([
        [['$24.99', '$149.00', '$59.50'], 'money', 'money (USD)'],
        [['4.5 out of 5 stars', '3.9 out of 5 stars'], 'rating', 'rating'],
        [['2,345', '17', '890'], 'integer', 'whole number'],
        [['12.5', '3.25', '7'], 'number', 'number'],
        [['https://a.com/x', '/p/2', 'https://a.com/y'], 'url', 'url'],
        [['Jan 5, 2024', 'Feb 10, 2024'], 'date', 'date'],
        [['-15%', '20%'], 'percent', 'percent'],
        [['10K+ bought', '2K+ bought'], 'count', 'count'],
        [['Desk lamp', 'Office chair'], 'text', 'text'],
        [['2024', '2023'], 'integer', 'whole number'],
    ] as const)('%j → %s', (values, type, label) => {
        const d = detectType([...values]);
        expect(d.type).toBe(type);
        expect(d.label).toBe(label);
    });
    it('uses the column name for plain numbers in a price column', () => {
        expect(detectType(['24.99', '149'], 'Price').type).toBe('money');
    });
});

describe('applyOps', () => {
    it('takes HTML out, keeping line breaks, and makes a link whole', async () => {
        const { applyOps } = await import('./chain');
        expect(applyOps('<p>Soft &amp; light.</p><ul><li>Pockets</li><li>Cuffs</li></ul>', [{ op: 'stripHtml' }])).toBe('Soft & light.\nPockets\nCuffs');
        expect(applyOps('/p/shirt', [{ op: 'absoluteUrl' }], 'https://shop.example.com/c/men')).toBe('https://shop.example.com/p/shirt');
        expect(applyOps('https://cdn.example.com/a.jpg', [{ op: 'absoluteUrl' }], 'https://shop.example.com/')).toBe('https://cdn.example.com/a.jpg');
        expect(applyOps('//cdn.example.com/a.jpg', [{ op: 'absoluteUrl' }], 'https://shop.example.com/')).toBe('https://cdn.example.com/a.jpg');
        expect(applyOps('Relaxed fit', [{ op: 'absoluteUrl' }], 'https://shop.example.com/')).toBe('Relaxed fit');
    });
});
