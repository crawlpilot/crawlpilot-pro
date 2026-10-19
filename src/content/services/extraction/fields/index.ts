/**
 * Field-first list extraction: decide a list's fields once, from all its sampled rows, then read
 * exactly those fields from every row of every page with `readRow`.
 *
 * Each field is a selector relative to the row plus the attribute to read (after thenos
 * `markdown/rows.py`: "a column read document-wide and zipped back together by position misaligns
 * the moment one row lacks a cell"). Its ID is a slug of its name (`price`, `was_price`), not a
 * hash of a DOM path, so it stays the same across rows, pages and runs, and the data table has
 * nothing left to merge.
 *
 * Inference is a pipeline, one file per stage:
 *   1 gate   keep the rows that are items
 *   2 group  values → candidate fields with row-relative selectors (a repeated component read whole)
 *   3 merge  one field per thing
 *   3b split one value holding several → a field per part (template slots, label/value pairs)
 *   4 prune  drop boilerplate
 *   5 name   evidence-based names
 *   6 meaning one column per meaning: precise readings kept, layouts joined, badges listed
 */
import { collectAtoms, withAtomCache } from '../atoms';
import { jsonMeaning, type StructuredSource } from '../structuredRows';
import type { ColumnType } from '../../../../shared/types/database';
import { gateRows } from './gate';
import { groupFields } from './group';
import { collapseComponents } from './component';
import { mergeFields } from './merge';
import { baseNames, columnType, uniqueNames } from './name';
import { refineFields } from './meaning';
import { parses } from './parse';
import { pruneFields } from './prune';
import { itemLinkField } from './link';
import { splitFields } from './split';
import { tableFields } from './table';
import { Field, FIELD_SCHEMA_VERSION, FieldInference, FieldReader, fieldId, ReaderColumn } from './types';

export { hasReaders, readRow, unmappedCount } from './read';
export { checkPage, isPending, readWhenReady } from './health';
export type { FieldReader, FieldInference, ReaderColumn, RowGate } from './types';

const MAX_SAMPLE = 40;

/**
 * The rows to infer from: all of them up to MAX_SAMPLE, otherwise evenly spread over the whole list
 * (first and last included), so a card layout that only appears further down still shapes the fields.
 */
function sampleRows(rows: Element[]): Element[] {
    if (rows.length <= MAX_SAMPLE) return rows;
    const step = (rows.length - 1) / (MAX_SAMPLE - 1);
    return Array.from({ length: MAX_SAMPLE }, (_, i) => rows[Math.round(i * step)]);
}

function readerOf(f: Field): Omit<FieldReader, 'alternates'> {
    return {
        v: FIELD_SCHEMA_VERSION,
        chain: [f.selector],
        attr: f.attr,
        shape: f.shape,
        ...(f.slot !== undefined ? { slot: f.slot, template: f.template } : {}),
        ...(f.kinds ? { kinds: f.kinds, kind: f.kind } : {}),
        ...(f.many ? { many: true } : {}),
        ...(f.first ? { first: true } : {}),
        ...(f.derive ? { derive: f.derive } : {}),
        ...(f.all ? { all: true } : {}),
        ...(f.link ? { link: f.link } : {}),
    };
}

/**
 * Infers the fields of a list from its rows. The result's columns carry their readers; read every
 * row (this page's and later pages') with `readRow(row, columns)`.
 */
export function inferFields(rowEls: Element[], opts: { decided?: boolean } = {}): FieldInference {
    return withAtomCache(() => infer(sampleRows(rowEls), !!opts.decided));
}

function infer(sampled: Element[], decided: boolean): FieldInference {
    const problems: string[] = [];
    if (sampled.length === 0) return { columns: [], problems: ['The rows selector matched nothing.'] };
    if (sampled[0].tagName === 'TR') return { columns: tableFields(sampled), problems };

    // 1. Items only.
    const sampledAtoms = sampled.map(collectAtoms);
    const { gate, keep } = gateRows(sampled, sampledAtoms, decided);
    const rows = sampled.filter((_, i) => keep[i]);
    const rowsAtoms = sampledAtoms.filter((_, i) => keep[i]);
    const skipped = sampled.length - rows.length;
    if (skipped > 0) problems.push(`${skipped} of ${sampled.length} picked elements don't look like the others (headers, ads, widgets) and are skipped.`);
    if (rows.length === 0) return { columns: [], problems };
    const n = rows.length;

    // 2–5.
    const pruned = pruneFields(splitFields(mergeFields(collapseComponents(groupFields(rows, rowsAtoms), rows))), n);
    const link = itemLinkField(rows, pruned);
    if (link) pruned.unshift(link);
    const refined = refineFields(pruned, baseNames(pruned), n);
    const fields = refined.fields;
    const names = uniqueNames(fields, refined.names);

    // Checks for the review step.
    fields.forEach((f, i) => {
        if (n >= 4 && f.values.size / n < 0.5) problems.push(`“${names[i]}” is empty in ${n - f.values.size} of ${n} rows.`);
    });
    if (n > 1) {
        const keys = rowsAtoms.map(atoms => atoms.map(a => a.value).join('\u0001'));
        if (new Set(keys).size === 1) problems.push(`All ${n} rows are identical: the rows selector may match one repeated element.`);
    }

    // An ID that repeats can't tell rows apart (an export keyed by it loses rows).
    fields.forEach((f, i) => {
        if (!/\bID\b|\bSKU\b|\bASIN\b/.test(names[i]) || f.values.size < 3) return;
        const distinct = new Set(f.values.values()).size;
        if (distinct < f.values.size) problems.push(`ID check: “${names[i]}” repeats; ${f.values.size - distinct} of ${f.values.size} rows share a value with another row.`);
    });

        // Images first, then reading order.
    const named = fields.map((f, i) => ({ f, name: names[i] }));
    named.sort((a, b) => (a.f.attr === 'src' ? 0 : 1) - (b.f.attr === 'src' ? 0 : 1) || a.f.order - b.f.order);

    const columns: ReaderColumn[] = named.map(({ f, name }, order) => {
        const id = fieldId(name);
        const meaning = refined.names[fields.indexOf(f)];
        const type = columnType(f, meaning);
        const values = [...f.values.values()];
        const round = (x: number) => Math.round(x * 100) / 100;
        return {
            id,
            name,
            type,
            order,
            selector: f.selector,
            reader: {
                ...readerOf(f),
                meaning,
                expect: {
                    fill: round(f.values.size / n),
                    ...(type === 'number' || type === 'price' ? { parse: round(values.filter(v => parses(v, type)).length / Math.max(1, values.length)) } : {}),
                },
                ...(f.alts?.length ? { alternates: f.alts.map(readerOf) } : {}),
                ...(gate ? { rowGate: gate } : {}),
            },
        };
    });
    // A number or price column whose values don't read as one (words around it, two amounts).
    for (const c of columns) {
        const parse = c.reader?.expect?.parse;
        if (parse !== undefined && parse < 0.9) problems.push(`Number check: “${c.name}” reads as a ${c.type === 'price' ? 'price' : 'number'} in only ${Math.round(parse * 100)}% of rows.`);
    }
    return { columns, problems };
}

/** The element's siblings that look like it (same tag), itself included: rows to infer from. */
export function similarSiblings(el: Element): Element[] {
    const parent = el.parentElement;
    if (!parent) return [el];
    const same = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    return same.length > 0 ? same : [el];
}

/** Columns that read a structured source's fields from the JSON item behind each row. */
export function structuredColumns(source: StructuredSource): ReaderColumn[] {
    return source.fields.map((f, order) => {
        const id = fieldId(f.name);
        return {
            id,
            name: f.name,
            type: f.type as ColumnType,
            order,
            selector: f.key,
            reader: {
                v: FIELD_SCHEMA_VERSION,
                chain: [],
                attr: 'text',
                shape: 'text',
                json: { kind: source.kind, path: source.path, anchor: source.anchor, anchorIsUrl: source.anchorIsUrl, ...(source.anchorKind ? { anchorKind: source.anchorKind } : {}), key: f.key },
                meaning: jsonMeaning(f.key),
            },
        };
    });
}
