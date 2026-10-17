import type { Atom, AtomAttr, Shape } from '../atoms';
import type { JsonSpec } from '../structuredRows';
import type { Column } from '../ExtractionTypes';

export const FIELD_SCHEMA_VERSION = 2;

/** How one column is read from a row. Saved on the column, so recipes and later pages reuse it. */
export interface FieldReader {
    v: typeof FIELD_SCHEMA_VERSION;
    /** Row-relative selectors, best first; the first that yields a value wins (variant cards). */
    chain: string[];
    attr: AtomAttr;
    /** For nodes that repeat inside a row: which slot of `template` this field is. */
    slot?: number;
    template?: Shape[];
    /** Every match is a value: images → JSON array, links → JSON array, text → joined. */
    many?: boolean;
    shape: Shape;
    /** Which elements are items of the list (the same on every column); others read as empty rows. */
    rowGate?: RowGate;
    /** Keep only values of this shape (a field the user split by kind of value). */
    onlyShape?: Shape;
    /** Read from the page's JSON item behind the row instead of the DOM (structured data first). */
    json?: JsonSpec;
    /** Readers tried in order when this one finds nothing (fields the user joined into this one). */
    alternates?: Omit<FieldReader, 'alternates'>[];
}

/**
 * Which picked elements are really items of the list. A results container also holds headers
 * ("Results"), widgets ("Related searches"), ad blocks and footers; each item has most of the list's
 * common structure and little else, so a row is kept when it has at least half of the core
 * signatures (those in most rows) and they make up a fair share of its own. Saved with the fields,
 * so every page of a run skips the same kinds of non-item elements.
 */
export interface RowGate {
    core: string[];
    /** Share of the core a row must have. */
    cover: number;
    /** Share of a row's own signatures that must be core. */
    own: number;
}

export type ReaderColumn = Column & { reader?: FieldReader };

export interface FieldInference {
    columns: ReaderColumn[];
    /** Checks on the result (thenos `rows._problems`), plain sentences for the review step. */
    problems: string[];
}

/** A candidate field during inference. */
export interface Field {
    key: string;
    attr: AtomAttr;
    selector: string;
    slot?: number;
    template?: Shape[];
    many?: boolean;
    /** Row index → value, for checks and naming. */
    values: Map<number, string>;
    atoms: Atom[];
    shape: Shape;
    order: number;
    /** Fields joined into this one (the same thing in another card layout), tried in order. */
    alts?: Field[];
}

export const TEXTUAL = new Set<AtomAttr>(['text', 'own', 'aria-label', 'title']);

export function mode<T>(items: T[]): T {
    const counts = new Map<T, number>();
    items.forEach(i => counts.set(i, (counts.get(i) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function norm(v: string): string {
    return v.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function fieldId(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
}

export function query(row: Element, selector: string): Element[] {
    try {
        if (selector === ':scope') return [row];
        return Array.from(row.querySelectorAll(selector));
    } catch {
        return [];
    }
}
