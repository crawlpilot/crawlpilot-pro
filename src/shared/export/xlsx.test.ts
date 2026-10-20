import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { columnLetter, sheetName, xlsxBytes } from './xlsx';

const parts = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));
const cell = (sheet: string, ref: string) => new RegExp(`<c r="${ref}"[^>]*>[\\s\\S]*?</c>`).exec(sheet)?.[0] ?? '';

describe('Excel export', () => {
    const columns = [
        { id: 'title', name: 'Title', type: 'text' },
        { id: 'price', name: 'Price', type: 'price' },
        { id: 'rating', name: 'Rating', type: 'number' },
        { id: 'date', name: 'Listed', type: 'date' },
        { id: 'url', name: 'URL', type: 'url' },
        { id: 'images', name: 'Images', type: 'image_array' },
    ];
    const rows = [
        { title: 'Desk <lamp> & "shade"', price: '$1,299.00', rating: 4.5, date: '2026-10-20', url: 'https://shop.test/p/1?a=1&b=2', images: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'] },
        { title: 'Floor lamp', price: 'Call for price', rating: null, date: '2026-10-20T14:30:00Z', url: 'not a link' },
    ];

    it('is a workbook with one sheet, a bold frozen header and filters', () => {
        const p = parts(xlsxBytes(columns, rows, 'Lamps: page 1/2'));
        expect(Object.keys(p).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/_rels/sheet1.xml.rels', 'xl/worksheets/sheet1.xml']);
        expect(p['xl/workbook.xml']).toContain('<sheet name="Lamps page 1 2"');
        const sheet = p['xl/worksheets/sheet1.xml'];
        expect(cell(sheet, 'A1')).toContain('s="4"');
        expect(cell(sheet, 'A1')).toContain('<t>Title</t>');
        expect(sheet).toContain('state="frozen"');
        expect(sheet).toContain('<autoFilter ref="A1:F3"/>');
    });

    it('numbers, prices and dates are typed cells; text is escaped; lists are one per line', () => {
        const sheet = parts(xlsxBytes(columns, rows))['xl/worksheets/sheet1.xml'];
        expect(cell(sheet, 'A2')).toContain('Desk &lt;lamp&gt; &amp; &quot;shade&quot;');
        expect(cell(sheet, 'B2')).toBe('<c r="B2"><v>1299</v></c>');
        expect(cell(sheet, 'B3')).toContain('t="inlineStr"');
        expect(cell(sheet, 'C2')).toBe('<c r="C2"><v>4.5</v></c>');
        expect(cell(sheet, 'C3')).toBe('');
        // 2026-10-20 is Excel day 46315; a time makes it a date-time.
        expect(cell(sheet, 'D2')).toBe('<c r="D2" s="1"><v>46315</v></c>');
        expect(cell(sheet, 'D3')).toMatch(/^<c r="D3" s="2"><v>46315\.6041/);
        expect(cell(sheet, 'F2')).toContain('https://cdn.test/1.jpg\nhttps://cdn.test/2.jpg');
        expect(cell(sheet, 'F2')).toContain('s="5"');
    });

    it('links are hyperlinks; text that is no link stays text', () => {
        const p = parts(xlsxBytes(columns, rows));
        const sheet = p['xl/worksheets/sheet1.xml'];
        expect(cell(sheet, 'E2')).toContain('s="3"');
        expect(sheet).toContain('<hyperlink ref="E2" r:id="rId1"/>');
        expect(p['xl/worksheets/_rels/sheet1.xml.rels']).toContain('Target="https://shop.test/p/1?a=1&amp;b=2" TargetMode="External"');
        expect(cell(sheet, 'E3')).not.toContain('s="3"');
    });

    it('column letters and sheet names as Excel takes them', () => {
        expect([0, 25, 26, 51, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
        expect(sheetName('')).toBe('Data');
        expect(sheetName('x'.repeat(40))).toHaveLength(31);
    });
});
