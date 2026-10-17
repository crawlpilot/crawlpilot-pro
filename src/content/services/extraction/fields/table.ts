import { AtomAttr, atomText, Shape, shapeOf } from '../atoms';
import type { ColumnType } from '../ExtractionTypes';
import { FIELD_SCHEMA_VERSION, fieldId, mode, ReaderColumn } from './types';

/**
 * Table rows: one column per cell position (an empty cell must not shift the cells after it),
 * named from the header row, plus a URL / image column for cells that usually hold one.
 */
export function tableFields(rows: Element[]): ReaderColumn[] {
    const table = rows[0].closest('table');
    const headerRow = table?.querySelector('thead tr') ??
        Array.from(table?.querySelectorAll('tr') ?? []).find(tr => tr.children.length > 0 && Array.from(tr.children).every(c => c.tagName === 'TH'));
    const headers = headerRow ? Array.from(headerRow.children).map(c => atomText(c)) : [];
    const width = Math.max(...rows.map(r => r.children.length));
    const used = new Set<string>();
    const unique = (name: string) => {
        let n = name;
        let i = 2;
        while (used.has(n)) n = `${name} ${i++}`;
        used.add(n);
        return n;
    };
    const column = (name: string, sel: string, attr: AtomAttr, shape: Shape, type: ColumnType): ReaderColumn => {
        const id = fieldId(name);
        return { id, originalId: id, name, type, selector: sel, reader: { v: FIELD_SCHEMA_VERSION, chain: [sel], attr, shape } };
    };

    const columns: ReaderColumn[] = [];
    for (let k = 1; k <= width; k++) {
        const cells = rows.map(r => r.children[k - 1]).filter(Boolean);
        const values = cells.map(c => atomText(c)).filter(Boolean);
        const name = unique(headers[k - 1] || `Column ${k}`);
        const cellSel = `:scope > :nth-child(${k})`;
        if (values.length > 0) {
            const shape = mode(values.slice(0, 20).map(v => shapeOf(v, 'cell')));
            const type: ColumnType = shape === 'price' ? 'price' : shape === 'date' ? 'date' : /^(number|rating|count)$/.test(shape) ? 'number' : 'text';
            columns.push(column(name, cellSel, 'cell', shape, type));
        }
        const links = cells.filter(c => c.querySelector('a[href]')).length;
        if (links >= cells.length / 2 && links > 0) columns.push(column(unique(`${name} URL`), `${cellSel} a[href]`, 'href', 'url', 'url'));
        const images = cells.filter(c => c.querySelector('img')).length;
        if (images >= cells.length / 2 && images > 0) columns.push(column(unique(`${name} Image`), `${cellSel} img`, 'src', 'image', 'image'));
    }
    columns.forEach((c, i) => { c.order = i; });
    return columns;
}
