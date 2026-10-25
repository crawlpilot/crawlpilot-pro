import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findTables } from './findTables';
import { loadPage } from '../../../test/corpus/measure';

const FIXTURE = readFileSync(resolve(__dirname, '../../../../e2e/site/tables.html'), 'utf8');

function load(html: string) {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
}

describe('tables on a page (fixture)', () => {
    load(FIXTURE);
    const tables = findTables(document, false);
    const byName = Object.fromEntries(tables.map(t => [t.name, t]));

    it('finds the data tables, not the layout, nav, tiny, hidden or presentation ones', () => {
        expect(tables.map(t => t.name)).toEqual(['Products', 'Opening hours', 'Revenue', 'Team members', 'Details', 'Specifications']);
        expect(tables.map(t => t.index)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(byName.Specifications.rows).toEqual([['HTML Standard', 'Living']]);
    });

    it('a header of th, and a link column with the URLs', () => {
        const t = byName.Products;
        expect(t.columns).toEqual(['Name', 'Name (link)', 'Price', 'Stock']);
        expect(t.rows).toHaveLength(3);
        expect(t.rows[0][0]).toBe('Lamp');
        expect(t.rows[0][1]).toMatch(/\/p\/lamp$/);
        expect(t.rows[2]).toEqual(['Chair', expect.stringMatching(/\/p\/chair$/), '$89.00', '0']);
    });

    it('rowspan and colspan are expanded so every row has every column', () => {
        expect(byName['Opening hours'].columns).toEqual(['Day', 'Opens', 'Closes']);
        expect(byName['Opening hours'].rows).toEqual([
            ['Monday', '09:00', '17:00'],
            ['Tuesday', '09:00', '18:00'],
            ['Wednesday', 'Closed', 'Closed'],
        ]);
    });

    it('two header rows are joined per column', () => {
        expect(byName.Revenue.columns).toEqual(['Region', 'Q1 › Revenue', 'Q1 › Cost', 'Q2 › Revenue', 'Q2 › Cost']);
        expect(byName.Revenue.rows[1]).toEqual(['South', '8', '3', '9', '4']);
    });

    it('an ARIA grid of divs, named by its aria-label', () => {
        expect(byName['Team members']).toMatchObject({ kind: 'grid', columns: ['Name', 'Role'], rows: [['Ana', 'Design'], ['Bo', 'Engineering'], ['Cy', 'Sales']] });
    });

    it('no header: Column 1, Column 2, named by the heading above', () => {
        expect(byName.Details).toMatchObject({ columns: ['Column 1', 'Column 2'], rows: [['Weight', '1.2 kg'], ['Colour', 'Oak']] });
    });

    it('no caption, label or heading: Table N', () => {
        load('<body><p>Intro</p><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table></body>');
        expect(findTables(document, false).map(t => t.name)).toEqual(['Table 1']);
        load(FIXTURE);
    });
});

describe('tables on corpus pages', () => {
    it('Wikipedia: its 3 data tables with their headers; navboxes and footnote links left out', () => {
        loadPage('corpus/article-wikipedia.html.gz');
        const tables = findTables(document, false);
        expect(tables.map(t => [t.name, t.rows.length, t.columns.length])).toEqual([
            ['Efficacy and efficiency', 7, 3],
            ['Comparison of efficacy by power', 11, 5],
            ['Examples', 4, 5],
        ]);
        // Two header rows joined, citation markers dropped.
        expect(tables[1].columns[1]).toBe('120-volt lamps › Output (lm)');
        // A real link column stays; footnote links ("#cite_note-…") never make one.
        expect(tables[2].columns).toEqual(['Description', 'SI', 'Inch', 'Details', 'Details (link)']);
        expect(tables.flatMap(t => t.rows.flat()).some(v => v.includes('#cite_note'))).toBe(false);
    });

    it('MDN: its only table has one column (a list of links), so none', () => {
        loadPage('corpus/docs-mdn.html.gz');
        expect(findTables(document, false)).toEqual([]);
    });
});
