/**
 * Field-first list extraction: decide a list's fields once, from all its sampled rows, then read
 * exactly those fields from every row of every page with `readRow`.
 *
 * Each field is a selector relative to the row plus the attribute to read (after thenos
 * `markdown/rows.py`: "a column read document-wide and zipped back together by position misaligns
 * the moment one row lacks a cell"). Its ID is a slug of its name (`price`, `was_price`), not a
 * hash of a DOM path, so it stays the same across rows, pages and runs, and the data table has
 * nothing left to merge.
 */
import { alignToTemplate, Atom, AtomAttr, atomText, collectAtoms, isAtomRoot, readValue, Shape, shapeOf, withAtomCache } from './atoms';
import { nodeStep } from './nodeName';
import { JsonSpec, readJsonField, StructuredSource } from './structuredRows';
import type { Column, ColumnType } from './ExtractionTypes';

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

export type ReaderColumn = Column & { reader?: FieldReader };

export interface FieldInference {
    columns: ReaderColumn[];
    /** Checks on the result (thenos `rows._problems`), plain sentences for the review step. */
    problems: string[];
}

const MAX_SAMPLE = 40;
const MANY_THRESHOLD: Partial<Record<AtomAttr, number>> = { src: 1, href: 2, text: 5, own: 5 };
const ATTR_RANK: Record<AtomAttr, number> = { text: 0, own: 1, cell: 0, datetime: 2, href: 3, src: 4, 'aria-label': 5, title: 6 };

export function hasReaders(columns: unknown): columns is ReaderColumn[] {
    return Array.isArray(columns) && columns.some((c: any) => c?.reader?.v === FIELD_SCHEMA_VERSION);
}

// ---------------------------------------------------------------------------------- reading

function query(row: Element, selector: string): Element[] {
    try {
        if (selector === ':scope') return [row];
        return Array.from(row.querySelectorAll(selector));
    } catch {
        return [];
    }
}

function readField(row: Element, r: FieldReader): string | undefined {
    const main = readOne(row, r, r.onlyShape);
    if (main !== undefined || !r.alternates) return main;
    for (const alt of r.alternates) {
        const v = readOne(row, alt, r.onlyShape);
        if (v !== undefined) return v;
    }
    return undefined;
}

function readOne(row: Element, r: Omit<FieldReader, 'alternates'>, onlyShape?: Shape): string | undefined {
    const ofShape = (v: string) => !onlyShape || shapeOf(v, r.attr) === onlyShape;
    if (r.json) {
        const v = readJsonField(row, r.json);
        return v !== undefined && ofShape(v) ? v : undefined;
    }
    for (const sel of r.chain) {
        const values = query(row, sel).filter(el => isAtomRoot(el, row, r.attr)).map(el => readValue(el, r.attr)).filter(Boolean);
        if (values.length === 0) continue;
        if (r.many) {
            const uniq = [...new Set(values.filter(ofShape))];
            if (uniq.length === 0) continue;
            return r.attr === 'src' || r.attr === 'href' ? JSON.stringify(uniq) : uniq.join('; ');
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

/** Reads a row with frozen columns. Columns without a reader (legacy) are left out. */
export function readRow(row: Element, columns: ReaderColumn[]): Record<string, string> {
    const out: Record<string, string> = {};
    const gate = columns.find(c => c.reader?.rowGate)?.reader?.rowGate;
    if (gate && !rowFitsGate(row, gate)) return out;
    for (const col of columns) {
        if (!col.reader) continue;
        const v = readField(row, col.reader);
        if (v !== undefined && v !== '') out[col.id] = v;
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
    const covered: Element[] = [];
    for (const col of columns) {
        const r = col.reader;
        if (!r) continue;
        for (const reader of [r, ...(r.alternates ?? [])]) {
            reader.chain.forEach(sel => covered.push(...query(row, sel)));
        }
    }
    const isCovered = (el: Element) => covered.some(c => c === el || c.contains(el));
    return collectAtoms(row).filter(a =>
        (a.attr === 'text' || a.attr === 'own') && !a.el.closest('button, [role="button"]') && !isCovered(a.el)).length;
}

// -------------------------------------------------------------------------------- inference

interface Group {
    sig: string;
    attr: AtomAttr;
    /** Per sampled row: this signature's atoms in document order. */
    perRow: Map<number, Atom[]>;
    maxCount: number;
}

interface Field {
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

function mode<T>(items: T[]): T {
    const counts = new Map<T, number>();
    items.forEach(i => counts.set(i, (counts.get(i) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function stepsCss(path: Element[], from: number): string {
    return path.slice(from).map(e => nodeStep(e).css).join(' > ');
}

/**
 * The shortest row-relative selector for a signature: in rows that have it, it must match exactly
 * the signature's elements; in rows that don't, it may only match the same kind of node (the same
 * leaf in a sponsored card's extra wrapper), never something else. So variant cards share one
 * selector, and one column, instead of producing a column each that someone merges later.
 */
function selectorFor(group: Group, rowAtoms: Map<Element, Atom[]>[], rows: Element[]): string {
    const sample = [...group.perRow.values()][0][0];
    const path = sample.path;
    if (path.length === 0) return ':scope';
    const leaf = nodeStep(path[path.length - 1]).label;
    const full = `:scope > ${stepsCss(path, 0)}`;

    const candidates = path.map((_, i) => stepsCss(path, path.length - 1 - i));
    candidates.push(full);
    for (const candidate of candidates) {
        let ok = true;
        for (let r = 0; r < rows.length && ok; r++) {
            const matched = query(rows[r], candidate);
            const own = group.perRow.get(r);
            // A match that reads nothing (an inline piece inside another value, an empty node) is harmless.
            const reads = (el: Element) => isAtomRoot(el, rows[r], group.attr) && readValue(el, group.attr) !== '';
            if (own) {
                const want = new Set(own.map(a => a.el));
                ok = own.every(a => matched.includes(a.el)) && matched.every(el => want.has(el) || !reads(el));
            } else {
                ok = matched.every(el => !reads(el) || (rowAtoms[r].get(el) ?? []).some(a =>
                    a.attr === group.attr && nodeStep(a.el).label === leaf));
            }
        }
        if (ok) return candidate;
    }
    return full;
}

function groupsOf(rowsAtoms: Atom[][]): Group[] {
    const bySig = new Map<string, Group>();
    rowsAtoms.forEach((atoms, r) => {
        for (const a of atoms) {
            let g = bySig.get(a.sig);
            if (!g) { g = { sig: a.sig, attr: a.attr, perRow: new Map(), maxCount: 0 }; bySig.set(a.sig, g); }
            const list = g.perRow.get(r) ?? [];
            list.push(a);
            g.perRow.set(r, list);
            g.maxCount = Math.max(g.maxCount, list.length);
        }
    });
    return [...bySig.values()];
}

/** Splits a group into fields: one, one per slot (aligned by shape), or one "many" field. */
function fieldsOf(group: Group, selector: string, docOrder: Map<Element, number>): Field[] {
    const firstOrder = (atoms: Atom[]) => Math.min(...atoms.map(a => docOrder.get(a.el) ?? 1e9));
    const many = group.maxCount > (MANY_THRESHOLD[group.attr] ?? 99);

    if (group.maxCount === 1 || many) {
        const values = new Map<number, string>();
        const atoms: Atom[] = [];
        group.perRow.forEach((list, r) => {
            atoms.push(...list);
            values.set(r, many ? list.map(a => a.value).join('; ') : list[0].value);
        });
        return [{
            key: `${selector}@${group.attr}`, attr: group.attr, selector, many: many || undefined,
            values, atoms, shape: mode(atoms.map(a => shapeOf(a.value, a.attr))), order: firstOrder(atoms),
        }];
    }

    // Repeated nodes: the template is the per-slot shape of the rows that have them all.
    const full = [...group.perRow.values()].filter(l => l.length === group.maxCount);
    const template: Shape[] = [];
    for (let s = 0; s < group.maxCount; s++) template.push(mode(full.map(l => shapeOf(l[s].value, l[s].attr))));

    const slots: Field[] = template.map((shape, slot) => ({
        key: `${selector}@${group.attr}#${slot}`, attr: group.attr, selector, slot, template,
        values: new Map(), atoms: [], shape, order: 0,
    }));
    group.perRow.forEach((list, r) => {
        const assigned = alignToTemplate(list.map(a => shapeOf(a.value, a.attr)), template);
        assigned.forEach((slot, i) => {
            if (slot < 0 || slots[slot].values.has(r)) return;
            slots[slot].values.set(r, list[i].value);
            slots[slot].atoms.push(list[i]);
        });
    });
    return slots.filter(f => f.atoms.length > 0).map(f => ({ ...f, order: firstOrder(f.atoms) }));
}

// ------------------------------------------------------------------------------------ rows

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

const GATE_COVER = 0.5;
const GATE_OWN = 0.3;

function jaccard(a: Set<string>, b: Set<string>): number {
    let inter = 0;
    a.forEach(x => { if (b.has(x)) inter++; });
    return inter / (a.size + b.size - inter || 1);
}

function passesGate(profile: Set<string>, gate: RowGate, core: Set<string>): boolean {
    if (profile.size === 0) return false;
    let inter = 0;
    profile.forEach(x => { if (core.has(x)) inter++; });
    return inter / core.size >= gate.cover && inter / profile.size >= gate.own;
}

function buildGate(profiles: Set<string>[]): RowGate | null {
    if (profiles.length < 4) return null;
    // The most typical row: the one most like all the others.
    let medoid = 0;
    let best = -1;
    profiles.forEach((p, i) => {
        let sum = 0;
        profiles.forEach((q, j) => { if (i !== j) sum += jaccard(p, q); });
        if (sum > best) { best = sum; medoid = i; }
    });
    const similar = profiles.filter(p => jaccard(p, profiles[medoid]) >= 0.3);
    const counts = new Map<string, number>();
    similar.forEach(p => p.forEach(sig => counts.set(sig, (counts.get(sig) ?? 0) + 1)));
    const core = [...counts.entries()].filter(([, c]) => c >= similar.length * 0.5).map(([sig]) => sig);
    return core.length >= 2 ? { core, cover: GATE_COVER, own: GATE_OWN } : null;
}

/**
 * A row's structure for the gate: the label path of each value, measured from the row's content root
 * (below any single-child wrappers), so the same card inside an extra wrapper (a sponsored slot)
 * matches while a block with a different structure (a video ad, a widget) doesn't.
 */
function profileOf(row: Element, atoms: Atom[]): Set<string> {
    let depth = 0;
    for (let el = row; el.children.length === 1 && depth < 6; el = el.children[0]) depth++;
    return new Set(atoms.map(a => `${a.path.slice(depth).map(e => nodeStep(e).label).join('>')}@${a.attr}`));
}

/** Whether a row on any page is an item of the list the fields were picked from. */
export function rowFitsGate(row: Element, gate: RowGate): boolean {
    return passesGate(profileOf(row, collectAtoms(row)), gate, new Set(gate.core));
}

// ------------------------------------------------------------------------------------ naming

/** Words that describe layout, state or a framework, never what a value is. */
const NOISE_WORDS = new Set(['text', 'label', 'value', 'wrapper', 'wrap', 'container', 'inner', 'outer', 'content', 'item', 'items',
    'component', 'root', 'box', 'block', 'el', 'elem', 'element', 'span', 'div', 'col', 'row', 'cell', 'info', 'details', 'detail',
    'card', 'tile', 'module', 'section', 'main', 'body', 'link', 'txt', 'lbl', 'field', 'data', 'top', 'bottom', 'left', 'right',
    'recipe', 'instrumentation', 'declarative', 'offscreen', 'outline', 'rush', 'faceout', 'bold', 'weight', 'normal', 'base', 'spacing',
    'size', 'widget', 'grid', 'list', 'group', 'line', 'clamp', 'truncate', 'color', 'style', 'theme', 'variant', 'primary', 'secondary',
    'small', 'large', 'medium', 'mini', 'micro', 'default', 'heading', 'title', 'none', 'show', 'visible', 'display', 'layout', 'puis',
    'puisg', 'csa', 'sg', 'aok', 'js', 'ui', 'mod', 'cmp', 'comp', 'internal', 'external', 'container', 'holder', 'area', 'region']);
/** Short words that do name a value. */
const SHORT_WORDS = new Set(['sku', 'age', 'url', 'tag', 'fee', 'tax', 'qty', 'new', 'id', 'isbn', 'upc', 'ean', 'mpn', 'brand', 'size']);
const STRIKE_CLASS = /strike|line-?through|\bwas\b|was-?price|old|original|list-?price|compare|crossed|regular-?price|before|rrp|msrp/i;
const UNIT_PRICE = /\/\s*(oz|fl\s?oz|lb|kg|g|ml|l|ct|count|each|unit|item|100\s?g|sq\s?ft)\b|\bper\s+\w+/i;
const REVIEW_WORDS = /reviews?|ratings?/i;
const SALES_WORDS = /\b(bought|sold|purchased|orders?)\b/i;
const BRACKET_COUNT = /^\(?[\d.,]+\s*[kKmM]?\+?\)?$/;

function titleCase(s: string): string {
    return s.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const TAGS = new Set(['a', 'abbr', 'article', 'aside', 'b', 'button', 'dd', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'i', 'img', 'label', 'li', 'main', 'nav', 'ol', 'p', 'picture', 'section', 'small',
    'span', 'strong', 'sub', 'sup', 'table', 'td', 'th', 'time', 'tr', 'u', 'ul']);

/**
 * A readable name from a class or test id, or "" when it names layout or a framework:
 * "product-card__brand-name" → "Brand Name", "title-differentiators" → "Differentiators",
 * "puis-bold-weight-text" → "".
 */
export function tidyLabel(label: string): string {
    if (TAGS.has(label.replace(/\[.*$/, ''))) return '';
    const last = label.split(/__|--/).pop() || label;
    const words = last
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(/[-_\s.:]+/)
        .map(w => w.toLowerCase())
        .filter(w => w && !NOISE_WORDS.has(w) && !/\d/.test(w) && (w.length > 3 || SHORT_WORDS.has(w)) && /[aeiouy]/.test(w));
    return titleCase(words.join(' '));
}

/** The element's own schema/test attribute (a wrapper's would name every field inside it alike). */
function anchorName(f: Field): string {
    const el = f.atoms[0].el;
    for (const attr of ['itemprop', 'data-testid', 'data-cy']) {
        const v = el.getAttribute(attr);
        if (v) { const t = tidyLabel(v); if (t) return t; }
    }
    return '';
}

/** A name from the element's own class or its parent's; further up, a wrapper's class names a different thing. */
function className(f: Field): string {
    for (const el of [...f.atoms[0].path].reverse().slice(0, 2)) {
        const t = tidyLabel(nodeStep(el).label);
        if (t) return t;
    }
    return '';
}

const WAS_LABEL = /^(was|list|list price|reg(ular)?|orig(inal)?|compare at|before|msrp|rrp)\s*(price)?\s*:?$/i;

/** Struck through (tag, class, `data-*strike*`, style) or labelled "List:" / "Was" just before it. */
function isStruck(f: Field): boolean {
    return f.atoms.slice(0, 5).some(a => WAS_LABEL.test((a.el.previousElementSibling?.textContent || '').trim()) || [a.el, ...a.path].some(el =>
        /^(S|DEL|STRIKE)$/.test(el.tagName) || STRIKE_CLASS.test(el.getAttribute('class') || '') ||
        Array.from(el.attributes).some(at => /strike/i.test(at.name) && at.value !== 'false') ||
        /line-through/.test((el as HTMLElement).style?.textDecoration || '') ||
        (el === a.el && /line-through/.test(getComputedStyle(el).textDecorationLine || ''))));
}

const WAS_BEFORE = /(was|list|reg(ular)?|orig(inal)?|compare at|before|msrp|rrp)\s*(price)?\s*:?\s*$/i;

/** The value says "List: $X", or another field of the same row says "Was $X" about it. */
function labelledWas(f: Field, all: Field[]): boolean {
    let rows = 0;
    let was = 0;
    f.values.forEach((value, r) => {
        rows++;
        const v = norm(value);
        if (WAS_BEFORE.test(v.replace(/[\p{Sc}\d.,\s]+$/u, ''))) { was++; return; }
        if (all.some(o => {
            if (o === f) return false;
            const text = norm(o.values.get(r) || '');
            const i = text.indexOf(v);
            return i > 0 && WAS_BEFORE.test(text.slice(0, i));
        })) was++;
    });
    return rows > 0 && was / rows >= 0.6;
}

function inHeading(f: Field): boolean {
    return f.atoms.some(a => /^H[1-6]$/.test(a.el.tagName) || !!a.el.closest('h1,h2,h3,h4,h5,h6'));
}

/** A name from evidence, in order: what the value is (image, link, price, rating…), schema or test attributes, headings, the class. */
function baseName(f: Field, all: Field[]): string {
    const anchor = anchorName(f);
    const sample = [...f.values.values()].slice(0, 20);
    if (f.attr === 'src') return f.many ? 'Images' : 'Image';
    if (f.attr === 'href') return f.many ? 'Links' : 'URL';
    if (f.attr === 'datetime') return 'Date';
    switch (f.shape) {
        case 'price':
            if (sample.some(v => /deliver|shipping/i.test(v))) return 'Delivery Price';
            if (isStruck(f) || labelledWas(f, all)) return 'Was Price';
            if (sample.some(v => UNIT_PRICE.test(v))) return 'Unit Price';
            return 'Price';
        case 'rating': return 'Rating';
        case 'count':
            if (sample.some(v => SALES_WORDS.test(v))) return 'Sales Volume';
            if (sample.some(v => REVIEW_WORDS.test(v)) || sample.every(v => BRACKET_COUNT.test(v.trim()))) return 'Reviews';
            return anchor || className(f) || 'Count';
        case 'date': return 'Date';
    }
    if (sample.some(v => SALES_WORDS.test(v)) && sample.every(v => v.length < 60)) return 'Sales Volume';
    if (anchor) return anchor;
    if ((f.attr === 'text' || f.attr === 'own') && inHeading(f)) return 'Title';
    const tag = f.atoms[0].el.tagName;
    if (tag === 'DT' || tag === 'TH') return 'Label';
    if (tag === 'DD') return 'Value';
    const cls = className(f);
    if (cls) return cls;
    // Short labels drawn from a small vocabulary ("Top Brand", "Best Seller", "Deal").
    const distinct = new Set(sample.map(norm));
    if (!f.many && sample.length >= 2 && sample.every(v => v.length <= 30) && distinct.size <= Math.max(3, sample.length * 0.4)) return 'Badge';
    return f.many ? 'Details' : 'Text';
}

function slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
}

function columnType(f: Field): ColumnType {
    if (f.attr === 'src') return f.many ? 'image_array' : 'image';
    if (f.attr === 'href') return f.many ? 'link_array' : 'url';
    switch (f.shape) {
        case 'price': return 'price';
        case 'rating': case 'count': case 'number': return 'number';
        case 'date': return 'date';
        default: return f.many ? 'text_array' : 'text';
    }
}

// ------------------------------------------------------------------------------------- infer

function norm(v: string): string {
    return v.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * A value as compared between fields: a one-item list is its item; a URL is its host and path
 * (no query, hash or trailing `ref=` segment), so the title link, the image link and the reviews
 * link to the same product compare equal.
 */
function canon(v: string): string {
    let s = v.trim();
    if (s.startsWith('[')) {
        try { const a = JSON.parse(s); if (Array.isArray(a) && a.length === 1) s = String(a[0]); } catch { /* text */ }
    }
    if (/^https?:\/\//i.test(s)) {
        try {
            const u = new URL(s);
            return (u.host + u.pathname.replace(/\/ref=[^/]*$/i, '').replace(/\/+$/, '')).toLowerCase();
        } catch { /* not a URL after all */ }
    }
    return norm(s);
}

/** The same value in every row where both have one, and they share most of their rows. */
function sameField(a: Field, b: Field): boolean {
    let shared = 0;
    let same = 0;
    a.values.forEach((v, r) => {
        const w = b.values.get(r);
        if (w === undefined) return;
        shared++;
        if (canon(v) === canon(w)) same++;
    });
    return shared > 0 && same === shared && shared >= Math.min(a.values.size, b.values.size) * 0.8;
}

/** Never in the same row, same kind of value: one field in two card layouts. */
function variantOf(a: Field, b: Field): boolean {
    if (a.attr !== b.attr || a.shape !== b.shape || a.many !== b.many) return false;
    for (const r of b.values.keys()) if (a.values.has(r)) return false;
    if (a.shape !== 'text') return true;
    const leaf = (f: Field) => nodeStep(f.atoms[0].el).label;
    return leaf(a) === leaf(b) && !TAGS.has(leaf(a));
}

const TEXTUAL = new Set<AtomAttr>(['text', 'own', 'aria-label', 'title']);

function alnum(s: string): number {
    return (s.match(/[\p{L}\p{N}]/gu) || []).length;
}

/**
 * Removes, in place, fields whose value is mostly other fields' values glued together: after taking
 * out every other field's value found in it, little of its own is left (≤25%) in most rows.
 */
function dropComposites(fields: Field[]): void {
    const order = [...fields].sort((a, b) => avgLen(b) - avgLen(a));
    for (const a of order) {
        if (!TEXTUAL.has(a.attr) || a.many) continue;
        const others = fields.filter(f => f !== a && f.attr !== 'src' && f.attr !== 'href');
        let rows = 0;
        let composite = 0;
        a.values.forEach((value, r) => {
            const total = alnum(value);
            if (total === 0) return;
            rows++;
            let rest = norm(value);
            let found = 0;
            // Longest first, so "4.4 out of 5 stars" goes before a bare "4.4".
            others.map(o => o.values.get(r)).filter((v): v is string => !!v && alnum(v) >= 2)
                .map(norm).sort((x, y) => y.length - x.length)
                .forEach(v => { if (rest.includes(v)) { rest = rest.replace(v, ' '); found++; } });
            if (found > 0 && alnum(rest) <= Math.max(total * 0.25, 5)) composite++;
        });
        if (rows > 0 && composite / rows >= 0.8) fields.splice(fields.indexOf(a), 1);
    }
}

function avgLen(f: Field): number {
    let t = 0;
    f.values.forEach(v => { t += v.length; });
    return f.values.size ? t / f.values.size : 0;
}

function readerOf(f: Field): Omit<FieldReader, 'alternates'> {
    return {
        v: FIELD_SCHEMA_VERSION,
        chain: [f.selector],
        attr: f.attr,
        shape: f.shape,
        ...(f.slot !== undefined ? { slot: f.slot, template: f.template } : {}),
        ...(f.many ? { many: true } : {}),
    };
}

/**
 * Infers the fields of a list from its rows. The result's columns carry their readers; read every
 * row (this page's and later pages') with `readRow(row, columns)`.
 *
 * Stages: 1 keep the rows that are items · 2 group their values into fields · 3 merge fields that
 * are the same thing · 4 drop boilerplate · 5 name · 6 checks.
 */
export function inferFields(rowEls: Element[]): FieldInference {
    return withAtomCache(() => inferFieldsCached(rowEls));
}

function inferFieldsCached(rowEls: Element[]): FieldInference {
    const sampled = rowEls.slice(0, MAX_SAMPLE);
    const problems: string[] = [];
    if (sampled.length === 0) return { columns: [], problems: ['The rows selector matched nothing.'] };
    if (sampled[0].tagName === 'TR') return { columns: tableFields(sampled), problems };

    // 1. Items only: headers, widgets and ad blocks between the cards are left out.
    const sampledAtoms = sampled.map(collectAtoms);
    const profiles = sampledAtoms.map((atoms, i) => profileOf(sampled[i], atoms));
    const gate = buildGate(profiles);
    const coreSet = new Set(gate?.core ?? []);
    const keep = sampled.map((_, i) => !gate || passesGate(profiles[i], gate, coreSet));
    const rows = sampled.filter((_, i) => keep[i]);
    const rowsAtoms = sampledAtoms.filter((_, i) => keep[i]);
    const skipped = sampled.length - rows.length;
    if (skipped > 0) problems.push(`${skipped} of ${sampled.length} picked elements don't look like the others (headers, ads, widgets) and are skipped.`);
    if (rows.length === 0) return { columns: [], problems };

    const rowAtoms = rowsAtoms.map(atoms => {
        const m = new Map<Element, Atom[]>();
        atoms.forEach(a => { const l = m.get(a.el) ?? []; l.push(a); m.set(a.el, l); });
        return m;
    });
    const docOrder = new Map<Element, number>();
    rowsAtoms.forEach(atoms => atoms.forEach((a, i) => { if (!docOrder.has(a.el)) docOrder.set(a.el, i); }));

    // 2. Group values by signature into fields, each with a row-relative selector.
    const byKey = new Map<string, Field>();
    for (const group of groupsOf(rowsAtoms)) {
        const selector = selectorFor(group, rowAtoms, rows);
        for (const f of fieldsOf(group, selector, docOrder)) {
            const existing = byKey.get(f.key);
            if (existing) {
                f.values.forEach((v, r) => { if (!existing.values.has(r)) existing.values.set(r, v); });
                existing.atoms.push(...f.atoms);
                existing.order = Math.min(existing.order, f.order);
            } else {
                byKey.set(f.key, f);
            }
        }
    }
    const n = rows.length;
    // Best first: most rows, then the better attribute, then reading order.
    let fields = [...byKey.values()].sort((a, b) =>
        b.values.size - a.values.size || ATTR_RANK[a.attr] - ATTR_RANK[b.attr] || a.order - b.order);

    // 3. One field per thing: the same value under two selectors is one field; the same kind of value
    //    that never shares a row with another is that field in a different card layout.
    const merged: Field[] = [];
    for (const f of fields) {
        if (merged.some(k => sameField(k, f))) continue;
        const host = merged.find(k => variantOf(k, f));
        if (host) {
            host.alts = [...(host.alts ?? []), f];
            f.values.forEach((v, r) => host.values.set(r, v));
            host.atoms.push(...f.atoms);
            continue;
        }
        merged.push(f);
    }

    // 4. Boilerplate: one odd card, the same label on every card that has it ("See options",
    //    "Ships to India", "List:"), tiny icons, descriptions made of other fields.
    fields = merged.filter(f => {
        if (n >= 8 && f.values.size <= 1) return false;
        if (TEXTUAL.has(f.attr) && f.values.size >= Math.min(3, n) && n >= 3 && new Set([...f.values.values()].map(norm)).size === 1) return false;
        // Labels for the value next to them ("List:", "Price:").
        if (TEXTUAL.has(f.attr) && [...f.values.values()].every(v => /:\s*$/.test(v) && v.length < 30)) return false;
        if (f.attr === 'src') {
            const img = f.atoms[0].el as HTMLImageElement;
            const w = img.naturalWidth || Number(img.getAttribute('width')) || 0;
            const h = img.naturalHeight || Number(img.getAttribute('height')) || 0;
            if ((w > 0 && w < 32) || (h > 0 && h < 32)) return false;
        }
        return true;
    });
    dropComposites(fields);

    // 5. Names: evidence-based, unique; the most-filled field gets the plain name.
    const used = new Set<string>();
    const named = fields.map(f => ({ f, name: baseName(f, fields) }));
    for (const x of named) {
        let name = x.name;
        if (used.has(name)) {
            const hint = className(x.f);
            if (hint && hint !== name && !used.has(`${name} (${hint})`)) name = `${name} (${hint})`;
        }
        let i = 2;
        const base = name;
        while (used.has(name)) name = `${base} ${i++}`;
        used.add(name);
        x.name = name;
    }

    // 6. Checks for the review step.
    named.forEach(({ f, name }) => {
        if (n >= 4 && f.values.size / n < 0.5) problems.push(`“${name}” is empty in ${n - f.values.size} of ${n} rows.`);
    });
    if (n > 1) {
        const keys = rowsAtoms.map(atoms => atoms.map(a => a.value).join('\u0001'));
        if (new Set(keys).size === 1) problems.push(`All ${n} rows are identical: the rows selector may match one repeated element.`);
    }

    // Images first, then reading order.
    named.sort((a, b) => (a.f.attr === 'src' ? 0 : 1) - (b.f.attr === 'src' ? 0 : 1) || a.f.order - b.f.order);

    const columns: ReaderColumn[] = named.map(({ f, name }, order) => {
        const id = slug(name);
        return {
            id,
            originalId: id,
            name,
            type: columnType(f),
            order,
            selector: f.selector,
            reader: {
                ...readerOf(f),
                ...(f.alts?.length ? { alternates: f.alts.map(readerOf) } : {}),
                ...(gate ? { rowGate: gate } : {}),
            },
        };
    });
    return { columns, problems };
}

/**
 * Table rows: one column per cell position (an empty cell must not shift the cells after it),
 * named from the header row, plus a URL / image column for cells that usually hold one.
 */
function tableFields(rows: Element[]): ReaderColumn[] {
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
        const id = slug(name);
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
        const id = slug(f.name);
        return {
            id,
            originalId: id,
            name: f.name,
            type: f.type as ColumnType,
            order,
            selector: f.key,
            reader: {
                v: FIELD_SCHEMA_VERSION,
                chain: [],
                attr: 'text',
                shape: 'text',
                json: { kind: source.kind, path: source.path, anchor: source.anchor, anchorIsUrl: source.anchorIsUrl, key: f.key },
            },
        };
    });
}
