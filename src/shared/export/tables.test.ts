import { describe, expect, it } from 'vitest';
import { tableCsv, tableResult, tableTsv } from './tables';

const t = { columns: ['Name', 'Name (link)', 'Note'], rows: [['Lamp', 'https://s.test/lamp', 'a\tb'], ['Desk, oak', 'https://s.test/desk', 'line\nbreak']] };

describe('table exports', () => {
    it('TSV pastes as cells: a tab or line break inside a cell becomes a space', () => {
        expect(tableTsv(t)).toBe('Name\tName (link)\tNote\nLamp\thttps://s.test/lamp\ta b\nDesk, oak\thttps://s.test/desk\tline break');
    });
    it('CSV quotes what needs it', () => {
        expect(tableCsv(t).split('\n')[2]).toBe('"Desk, oak",https://s.test/desk,"line');
    });
    it('a saved table: typed link column, source_url on each row', () => {
        const r = tableResult(t, 'https://s.test/page');
        expect(r.columns.map(c => c.type)).toEqual(['text', 'url', 'text']);
        expect(r.items[0]).toEqual({ Name: 'Lamp', 'Name (link)': 'https://s.test/lamp', Note: 'a\tb', source_url: 'https://s.test/page' });
        expect(r.count).toBe(2);
    });
});
