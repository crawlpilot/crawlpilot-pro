import { describe, it, expect } from 'vitest';
import type { Column, Row as TableRow } from '@/shared/types/database';
import { dropEmptyRows, explodeJsonColumns, exportData, visibleColumns, withDerivedColumns } from './pipeline';

const row = (id: number, data: Record<string, any>): TableRow => ({ id, data } as TableRow);

describe('data table pipeline', () => {
    it('explodes a JSON list column into one row per item and a column per position', () => {
        const columns: Column[] = [
            { id: 'url', name: 'URL', type: 'url' },
            { id: 'specs', name: 'Specs', type: 'json' },
            { id: 'specs__tabledata', name: 'Specs (raw)', type: 'tabledata', hidden: true },
        ];
        const rows = [row(1, { url: 'https://a.test', specs: JSON.stringify([['Weight', '2 kg'], ['Size', '15 in']]), specs__tabledata: '{}' })];
        const { displayRows, displayColumns } = explodeJsonColumns(rows, columns);
        expect(displayColumns.map(c => c.id)).toEqual(['url', 'specs__pos0', 'specs__pos1']);
        expect(displayRows.map(r => r.data)).toEqual([
            { url: 'https://a.test', specs__pos0: 'Weight', specs__pos1: '2 kg' },
            { url: null, specs__pos0: 'Size', specs__pos1: '15 in' },
        ]);
    });

    it('adds merged columns and hides their sources', () => {
        const columns: Column[] = [{ id: 'first', name: 'First', type: 'text' }, { id: 'last', name: 'Last', type: 'text' }];
        const { baseRows, baseColumns } = withDerivedColumns([row(1, { first: 'Ada', last: 'Lovelace' })], columns,
            [{ id: 'm', name: 'Name', sources: ['first', 'last'], separator: ' ' }], [], new Set());
        expect(baseColumns.map(c => c.id)).toEqual(['m']);
        expect(baseRows[0].m).toBe('Ada Lovelace');
    });

    it('drops empty rows and chooses the visible columns in order', () => {
        const columns: Column[] = [
            { id: 'title', name: 'Title', type: 'text' },
            { id: 'site', name: 'Site', type: 'text' },
            { id: 'empty', name: 'Empty', type: 'text' },
            { id: 'copy', name: 'Copy', type: 'text' },
            { id: 'source_url', name: 'Source URL', type: 'url' },
        ];
        const rows = dropEmptyRows([
            { title: 'A', site: 'x', copy: 'A', source_url: 'u1' },
            {},
            { title: 'B', site: 'x', copy: 'B', source_url: 'u2' },
        ], columns);
        expect(rows).toHaveLength(2);
        const cols = visibleColumns(columns, rows, { hideRepeatingData: true, removeEmptyColumns: true, hideMostlyEmptyColumns: true, removeDuplicateColumns: true });
        expect(cols.map(c => c.id)).toEqual(['source_url', 'title']);
    });

    it('exports list columns as arrays, without the raw table column', () => {
        const columns: Column[] = [
            { id: 'images', name: 'Images', type: 'image_array' },
            { id: 't__tabledata', name: 'raw', type: 'tabledata', hidden: true },
        ];
        const out = exportData(columns, [row(1, { images: '["a.jpg","b.jpg"]', t__tabledata: '{}' })], { images: 'Photos' }, [], []);
        expect(out.columns).toEqual([{ id: 'images', name: 'Photos', type: 'image_array' }]);
        expect(out.rows).toEqual([{ images: ['a.jpg', 'b.jpg'] }]);
    });
});
