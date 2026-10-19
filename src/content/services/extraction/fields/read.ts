/** Reading rows with frozen fields: the same on the preview, every later page and every run. */
import { alignToTemplate, collectAtoms, isAtomRoot, labelValue, meaningful, readValue, Shape, shapeOf, withAtomCache } from '../atoms';
import { readJsonField } from '../structuredRows';
import { kindOf } from './component';
import { applyDerive } from './split';
import { typedValue } from './parse';
import { rowFitsGate } from './gate';
import { tableHeaders } from './table';
import { FIELD_SCHEMA_VERSION, FieldReader, query, ReaderColumn } from './types';

export function hasReaders(columns: unknown): columns is ReaderColumn[] {
    return Array.isArray(columns) && columns.some((c: any) => c?.reader?.v === FIELD_SCHEMA_VERSION || c?.reader?.v === 2);
}

function readField(row: Element, r: FieldReader): string | undefined {
    if (r.all) {
        const vs = [r, ...(r.alternates ?? [])].map(x => readPart(row, x, r.onlyShape)).filter((v): v is string => !!v);
        return vs.length ? [...new Set(vs)].join('; ') : undefined;
    }
    const main = readPart(row, r, r.onlyShape);
    if (main !== undefined || !r.alternates) return main;
    for (const alt of r.alternates) {
        const v = readPart(row, alt, r.onlyShape);
        if (v !== undefined) return v;
    }
    return undefined;
}

/** A reader's value, or the part of it the reader takes (a template slot, the value after a label). */
function readPart(row: Element, r: Omit<FieldReader, 'alternates'>, onlyShape?: Shape): string | undefined {
    if (!r.derive) return readOne(row, r, onlyShape);
    // The part is taken from whichever of the selector's elements fits: all of them are read as one
    // list ("a; b; c"), which is also how a label/value pair list is held.
    return applyDerive(readOne(row, { ...r, derive: undefined, many: true }, undefined), r.derive);
}

/** A table column's cell in this row: under its header when the table has one, else at its position. */
function cellOf(row: Element, cell: NonNullable<FieldReader['cell']>): Element | null {
    if (cell.header !== undefined) {
        const i = tableHeaders(row.closest('table')).indexOf(cell.header);
        // The header is gone from this page's table: nothing to read, never another column's cell.
        return i >= 0 ? row.children[i] ?? null : null;
    }
    return row.children[cell.index - 1] ?? null;
}

/** Where a reader's chain is resolved: the row, or its cell for a table column. */
function baseOf(row: Element, r: Omit<FieldReader, 'alternates'>): Element | null {
    return r.cell ? cellOf(row, r.cell) : row;
}

function readOne(row: Element, r: Omit<FieldReader, 'alternates'>, onlyShape?: Shape): string | undefined {
    const ofShape = (v: string) => !onlyShape || shapeOf(v, r.attr) === onlyShape;
    if (r.json) {
        const v = readJsonField(row, r.json);
        return v !== undefined && ofShape(v) ? v : undefined;
    }
    const base = baseOf(row, r);
    if (!base) return undefined;
    for (const sel of r.chain) {
        // Labels are read where inference read them (`labelValue`): not the star link's "4.5 out of 5 stars, rating details".
        const read = (el: Element) => (r.attr === 'aria-label' || r.attr === 'title' ? labelValue(el, r.attr) : readValue(el, r.attr));
        const values = query(base, sel).filter(el => isAtomRoot(el, row, r.attr)).map(read).filter(meaningful);
        if (values.length === 0) continue;
        if (r.many) {
            const uniq = [...new Set(values.filter(ofShape))];
            if (uniq.length === 0) continue;
            return r.attr === 'src' || r.attr === 'href' ? JSON.stringify(uniq) : uniq.join('; ');
        }
        if (r.kinds && r.kind !== undefined) {
            const v = values.find(x => kindOf(x, r.kinds!) === r.kind && ofShape(x));
            if (v !== undefined) return v;
            continue;
        }
        if (r.slot !== undefined && r.template) {
            const slots = alignToTemplate(values.map(v => shapeOf(v, r.attr)), r.template);
            const i = slots.indexOf(r.slot);
            if (i >= 0 && ofShape(values[i])) return values[i];
            continue;
        }
        const v = values.find(ofShape);
        if (v !== undefined) return v;
    }
    return undefined;
}

/** Reads a row with frozen columns. A row that isn't an item of the list (see `RowGate`) reads as `{}`. */
export function readRow(row: Element, columns: ReaderColumn[]): Record<string, string> {
    return withAtomCache(() => readRowCached(row, columns));
}

function readRowCached(row: Element, columns: ReaderColumn[]): Record<string, string> {
    const out: Record<string, string> = {};
    const gate = columns.find(c => c.reader?.rowGate)?.reader?.rowGate;
    if (gate && !rowFitsGate(row, gate)) return out;
    for (const col of columns) {
        if (!col.reader) continue;
        const v = readField(row, col.reader);
        if (v !== undefined && v !== '') out[col.id] = typedValue(v, col.type);
    }
    return out;
}

/**
 * Text values in a row that none of the fields reads (outside buttons). Non-zero on a later page
 * means the layout changed or the row has something the picked fields miss.
 */
export function unmappedCount(row: Element, columns: ReaderColumn[]): number {
    // Fields read from the page's JSON cover the row's content without matching its nodes.
    if (columns.some(c => c.reader?.json)) return 0;
    return withAtomCache(() => unmappedCached(row, columns));
}

function unmappedCached(row: Element, columns: ReaderColumn[]): number {
    const covered: Element[] = [];
    for (const col of columns) {
        const r = col.reader;
        if (!r) continue;
        for (const reader of [r, ...(r.alternates ?? [])]) {
            const base = baseOf(row, reader);
            if (base) reader.chain.forEach(sel => covered.push(...query(base, sel)));
        }
    }
    const isCovered = (el: Element) => covered.some(c => c === el || c.contains(el));
    return collectAtoms(row).filter(a =>
        (a.attr === 'text' || a.attr === 'own') && !a.el.closest('button, [role="button"]') && !isCovered(a.el)).length;
}
