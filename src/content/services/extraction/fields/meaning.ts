/**
 * Stage 6: meanings (`docs/plans/generic-list-selectors-plan.md` §3.4, §3.5). With every field
 * named from its evidence, fields that mean the same thing are settled:
 *
 * - a link or image that is one member of a list field in the same row is that list's copy;
 * - a constant caption right before a field ("More Buying Choices" → "$37.61") names it;
 * - two readings of one number keep the precise one ("27,976" over "(27.9K)", 4.4 over a 4.5 star label);
 * - two copies of one number keep one ("Typical: $47.99" and "$47.99");
 * - one meaning in different card layouts, never in the same row, is one column (the plain and the
 *   sale price of a card are read from different elements);
 * - short labels nothing names (badges) at several places in a card are one list.
 *
 * The lexicon is word lists, not site rules: words in a hook or class say what a value is.
 */
import type { ColumnType } from '../../../../shared/types/database';
import { Field, norm, TEXTUAL } from './types';
import type { Shape } from '../atoms';

/** Meanings named by words in a hook, class or attribute (after `tidyLabel`), first match wins. */
const LEXICON: { name: string; words: RegExp; shapes?: Shape[] }[] = [
    { name: 'Review Count', words: /reviews?|ratings?\s?count|ratings$/i, shapes: ['count', 'number'] },
    { name: 'Rating', words: /rating|stars?\b/i, shapes: ['rating', 'number'] },
    { name: 'Brand', words: /brand/i },
    { name: 'Model', words: /\bmodel\b/i },
    { name: 'SKU', words: /\bsku\b/i },
    { name: 'Sponsored', words: /sponsor/i },
    { name: 'Badge', words: /\b(badges?|tags?|flags?|pills?|chips?|ribbons?|callouts?|badging)\b/i },
    { name: 'Delivery', words: /\b(delivery|shipping|fulfil?lment)\b/i },
    { name: 'Seller', words: /\b(seller|vendor|merchant|sold by)\b/i },
    { name: 'Title', words: /^(product\s?)?(title|name|product)$/i, shapes: ['text'] },
];

/** The meaning words name, or undefined: "Brandname" → Brand, "Product Reviews" → Review Count. */
export function meaningOf(words: string, shape: Shape): string | undefined {
    return LEXICON.find(m => m.words.test(words) && (!m.shapes || m.shapes.includes(shape)))?.name;
}

const PRICES = new Set(['Price', 'Was Price', 'Typical Price', 'From Price', 'To Price', 'Unit Price', 'Savings', 'Delivery Price']);
const NUMBERS = new Set(['Rating', 'Review Count']);

/** The type a meaning has, whatever its values look like. */
export function typeOfMeaning(name: string): ColumnType | undefined {
    if (PRICES.has(name)) return 'price';
    if (NUMBERS.has(name)) return 'number';
    return undefined;
}

/** Names that say nothing about the value: such fields with short values are badges. */
const UNNAMED = new Set(['Text', 'Badge']);

interface Num { n: number; step: number }

/** Values that are a number, so two fields can be compared as readings of one ("Acme 1" is a name). */
const NUMERIC_SHAPES = new Set<Shape>(['price', 'rating', 'count', 'number']);

const NUMBER = /(\d[\d,]*(?:\.\d+)?)\s?([KkMm](?![a-z]))?/g;

/** The numbers in a value with their precision: "(27.9K)" is 27900 to the hundred, "4.4" to the tenth. */
function numbers(v: string): Num[] {
    return [...v.matchAll(NUMBER)].map(m => {
        let digits = m[1];
        // "1,064" is one thousand and sixty-four; "4,5" is a decimal comma.
        digits = /,\d{3}(?!\d)/.test(digits) ? digits.replace(/,/g, '') : digits.replace(',', '.');
        const decimals = (digits.split('.')[1] ?? '').length;
        const scale = m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1;
        return { n: Number(digits) * scale, step: 10 ** -decimals * scale };
    }).filter(x => !Number.isNaN(x.n));
}

/** The one number a value holds, or undefined. */
export function onlyNumber(v: string): Num | undefined {
    const ns = numbers(v);
    return ns.length === 1 ? ns[0] : undefined;
}

/** A field's numbers by row, when (nearly) every value is one number. */
function numericValues(f: Field): Map<number, Num> | undefined {
    const out = new Map<number, Num>();
    f.values.forEach((v, r) => { const x = onlyNumber(v); if (x) out.set(r, x); });
    return out.size >= f.values.size * 0.9 && out.size > 0 ? out : undefined;
}

/** How coarse a field's numbers are: the coarsest value's step; star labels in halves count as halves. */
function coarseness(nums: Map<number, Num>, other: Map<number, Num>): number {
    const halves = (m: Map<number, Num>) => [...m.values()].every(x => Number.isInteger(x.n * 2));
    let step = Math.max(...[...nums.values()].map(x => x.step));
    if (halves(nums) && !halves(other)) step = Math.max(step, 0.5);
    return step;
}

const sharedRows = (a: Field, b: Field) => [...a.values.keys()].filter(r => b.values.has(r));

/** Same base name and most rows in common: two readings of one thing. */
function overlapping(a: Field, b: Field): number[] | undefined {
    const shared = sharedRows(a, b);
    return shared.length > 0 && shared.length >= Math.min(a.values.size, b.values.size) * 0.8 ? shared : undefined;
}

/**
 * The field of `a` and `b` to drop, when both read one number in each shared row: the coarser when
 * they agree within its precision, else the one with fewer rows (or more words) when they are equal.
 */
function lessPrecise(a: Field, b: Field): Field | undefined {
    const shared = overlapping(a, b);
    const na = numericValues(a);
    const nb = numericValues(b);
    if (!shared || !na || !nb || !NUMERIC_SHAPES.has(a.shape) || !NUMERIC_SHAPES.has(b.shape)) return undefined;
    const sa = coarseness(na, nb);
    const sb = coarseness(nb, na);
    const tolerance = Math.max(sa, sb);
    const rows = shared.filter(r => na.has(r) && nb.has(r));
    if (rows.length === 0 || rows.length < shared.length * 0.9) return undefined;
    const agree = rows.filter(r => Math.abs(na.get(r)!.n - nb.get(r)!.n) <= tolerance + 1e-9).length;
    if (agree < rows.length * 0.9) return undefined;
    const equal = rows.every(r => na.get(r)!.n === nb.get(r)!.n);
    if (!equal && sa !== sb) {
        const coarse = sa > sb ? a : b;
        const fine = coarse === a ? b : a;
        // The precise reading must cover the rows the coarse one has.
        return fine.values.size >= coarse.values.size * 0.9 ? coarse : undefined;
    }
    if (!equal) return undefined;
    const avg = (f: Field) => [...f.values.values()].reduce((n, v) => n + v.length, 0) / f.values.size;
    if (a.values.size !== b.values.size) return a.values.size < b.values.size ? a : b;
    return avg(a) > avg(b) ? a : b;
}

/** A single link or image whose value is, in every row it has, one member of a list field there. */
function memberOfList(f: Field, all: Field[]): boolean {
    if (f.many || (f.attr !== 'src' && f.attr !== 'href')) return false;
    return all.some(list => list !== f && list.many && list.attr === f.attr && [...f.values].filter(([r, v]) => {
        const l = list.values.get(r);
        if (!l) return false;
        try { return (JSON.parse(l) as string[]).includes(v); } catch { return false; }
    }).length >= f.values.size * 0.9);
}

/** The element's ancestors up to `levels` above it. */
function near(a: Element, b: Element, levels: number): boolean {
    let p: Element | null = a;
    for (let i = 0; i <= levels && p; i++, p = p.parentElement) if (p.contains(b)) return true;
    return false;
}

/**
 * A caption: the same short words (no digits) on every card that has them, always right before one
 * other field on exactly the same cards ("More Buying Choices" above "$37.61"). Returns that field.
 */
function captioned(label: Field, all: Field[], n: number): Field | undefined {
    if (!TEXTUAL.has(label.attr) || label.many || label.values.size < 2 || label.values.size >= n) return undefined;
    const vals = [...label.values.values()];
    if (new Set(vals.map(norm)).size !== 1 || /\d/.test(vals[0]) || vals[0].length > 40) return undefined;
    const rows = [...label.values.keys()].sort().join();
    const after = all
        .filter(f => f !== label && f.order > label.order && [...f.values.keys()].sort().join() === rows)
        .sort((x, y) => x.order - y.order)[0];
    if (!after) return undefined;
    // Nothing in between, and close in the card.
    if (all.some(f => f !== label && f !== after && f.order > label.order && f.order < after.order && f.values.size > 0
        && [...f.values.keys()].some(r => label.values.has(r)))) return undefined;
    return near(label.atoms[0].el, after.atoms[0].el, 3) ? after : undefined;
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase()).trim();

/** Fields joined into one list column, read from every place: `all` on the reader. */
function asList(parts: Field[]): Field {
    const [first, ...rest] = parts;
    const values = new Map<number, string>();
    const atoms = parts.flatMap(p => p.atoms);
    const rows = new Set(parts.flatMap(p => [...p.values.keys()]));
    for (const r of [...rows].sort((a, b) => a - b)) {
        const vs = [...new Set(parts.map(p => p.values.get(r)).filter((v): v is string => !!v))];
        values.set(r, vs.join('; '));
    }
    return {
        ...first, key: `${first.key}#all`, all: true, many: undefined, values, atoms,
        order: Math.min(...parts.map(p => p.order)),
        alts: [...(first.alts ?? []), ...rest.flatMap(p => [{ ...p, alts: undefined }, ...(p.alts ?? [])])],
    };
}

/** Joins `b` into `a` as a reader tried when `a` finds nothing (`b` never shares a row with `a`). */
function join(a: Field, b: Field): void {
    a.alts = [...(a.alts ?? []), { ...b, alts: undefined }, ...(b.alts ?? [])];
    b.values.forEach((v, r) => a.values.set(r, v));
    a.atoms.push(...b.atoms);
    a.order = Math.min(a.order, b.order);
}

/** Settles fields by meaning; returns the fields kept and their base names, in order. */
export function refineFields(input: Field[], names: string[], n: number): { fields: Field[]; names: string[] } {
    let items = input.map((f, i) => ({ f, name: names[i] }));
    const drop = (f: Field) => { items = items.filter(x => x.f !== f); };
    const fields = () => items.map(x => x.f);

    // Slots of a list read whole elsewhere (cards with two swatches read by slot, cards with more as a list): the list.
    for (const x of [...items]) {
        const list = x.f.slot !== undefined && items.find(o => o.f.many && o.f.attr === x.f.attr && o.f.selector === x.f.selector)?.f;
        if (!list) continue;
        x.f.values.forEach((v, r) => {
            const have = list.values.get(r);
            const members: string[] = have ? (list.attr === 'src' || list.attr === 'href' ? JSON.parse(have) : have.split('; ')) : [];
            if (!members.includes(v)) members.push(v);
            list.values.set(r, list.attr === 'src' || list.attr === 'href' ? JSON.stringify(members) : members.join('; '));
        });
        drop(x.f);
    }

    // A copy of one member of a list (a gallery's first image beside the card's main image).
    for (const x of [...items]) {
        if (memberOfList(x.f, fields())) {
            const covered = items.some(o => o !== x && !o.f.many && o.f.attr === x.f.attr && !o.f.first && o.f.values.size >= x.f.values.size);
            if (!x.f.first || covered) drop(x.f);
        }
    }

    // Captions name the field after them.
    for (const x of [...items]) {
        if (!items.includes(x)) continue;
        const target = captioned(x.f, fields(), n);
        if (!target) continue;
        const t = items.find(o => o.f === target)!;
        const caption = titleCase([...x.f.values.values()][0]).replace(/[:\s]+$/, '');
        t.name = typeOfMeaning(t.name) || NUMBERS.has(t.name) ? `${caption} ${t.name}` : caption;
        drop(x.f);
    }

    // Two readings of one thing: keep the precise one, or one of two equal copies.
    for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
            const a = items[i];
            const b = items[j];
            if (a.name !== b.name || !TEXTUAL.has(a.f.attr) || !TEXTUAL.has(b.f.attr) || a.f.many || b.f.many) continue;
            const loser = lessPrecise(a.f, b.f);
            if (!loser) continue;
            drop(loser);
            i = -1;
            break;
        }
    }

    // One meaning in different card layouts: one column.
    for (let i = 0; i < items.length; i++) {
        const a = items[i];
        if (UNNAMED.has(a.name) || a.f.many || a.f.first) continue;
        for (const b of items.slice(i + 1)) {
            if (b.name !== a.name || b.f.many || b.f.first || (b.f.attr === 'src') !== (a.f.attr === 'src') || (b.f.attr === 'href') !== (a.f.attr === 'href')) continue;
            if (sharedRows(a.f, b.f).length > 0) continue;
            join(a.f, b.f);
            drop(b.f);
        }
    }

    // Short labels at several places in the card: one list of badges. A badge is named so (a small
    // vocabulary, or a hook that says so), or is unnamed text only some cards have; free text every
    // card has (a person's name, their role) and bare numbers ("+2") are values of their own.
    const badges = items.filter(x => (x.name === 'Badge' || (x.name === 'Text' && x.f.values.size <= n * 0.5))
        && (TEXTUAL.has(x.f.attr) || x.f.attr === 'cell') && !x.f.many && !x.f.all
        && [...x.f.values.values()].every(v => v.length <= 40 && /\p{L}/u.test(v)));
    if (badges.length >= 2) {
        const list = asList(badges.map(x => x.f));
        const at = items.indexOf(badges[0]);
        items.splice(at, 1, { f: list, name: 'Badges' });
        badges.slice(1).forEach(x => drop(x.f));
    }
    return { fields: items.map(x => x.f), names: items.map(x => x.name) };
}
