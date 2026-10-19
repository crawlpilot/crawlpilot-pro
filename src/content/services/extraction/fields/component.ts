/**
 * Stage 2b: repeated components. A site hook that occurs more than once in a card (Walmart's
 * `badgeTagComponent`: a "Best seller" flag over the image, then "Save with", "Delivery as soon as
 * 12 mins", "Shipping, arrives today", "Pickup today" under the price) is a set of short phrases
 * split over spans. Read per fragment it becomes a column per fragment and position, and the
 * positions shift from card to card; read whole and joined, it is one cell holding five things.
 *
 * So each occurrence is read whole, and occurrences are split into fields twice:
 *   - by place: where in the card the component sits (the flag area, the fulfillment area);
 *   - by kind, in a place that holds several per card: phrases are one kind when they never occur
 *     in the same card and one's lead word is in the other ("Free shipping, arrives in 3+ days" and
 *     "Shipping, arrives today"); "Pickup today" and "Shipping, arrives today" share a word but
 *     appear together, so they stay apart.
 * Runs read the same way: an occurrence goes to the kind whose words it shares most (`kindOf`).
 */
import { Atom, collectAtoms, readValue, shapeOf } from '../atoms';
import { nodeStep } from '../nodeName';
import { AUTHOR_ATTRIBUTES, isStableAttributeValue } from '../../../../shared/selectors/stability';
import { Field, query, TEXTUAL } from './types';

const MIN_ROWS_REPEATING = 2;
/** Words that join a phrase, never what it is about. */
const STOP = new Set(['a', 'an', 'the', 'as', 'at', 'in', 'on', 'of', 'for', 'to', 'with', 'and', 'or', 'by', 'from', 'is', 'are', 'be', 'up', 'per', 'via']);

function cssAttr(attr: string, value: string): string {
    return `[${attr}="${value.replace(/["\\]/g, '\\$&')}"]`;
}

/** A phrase's content words, in order: lowercase letters only, joining words and numbers dropped. */
export function phraseWords(text: string): string[] {
    return (text.toLowerCase().match(/\p{L}+/gu) || []).filter(w => w.length > 1 && !STOP.has(w));
}

/**
 * The kind (index into `kinds`, each a kind's words) a phrase belongs to: the one sharing the most
 * of its words, the earlier on a tie; -1 when it shares none.
 */
export function kindOf(text: string, kinds: string[][]): number {
    const words = new Set(phraseWords(text));
    let best = -1;
    let bestScore = 0;
    kinds.forEach((k, i) => {
        const score = k.filter(w => words.has(w)).length / Math.max(words.size, 1);
        if (score > bestScore) { best = i; bestScore = score; }
    });
    return best;
}

/**
 * Author hooks (`attr="value"`) that occur at least twice in at least two rows, side by side: a hook
 * nested in itself (BestBuy's `MEDIUM_profile` around the price block and again inside it) is a
 * layout wrapper, not a component, so only its outermost occurrence counts.
 */
function repeatedHooks(rows: Element[]): string[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
        const perRow = new Map<string, number>();
        for (const attr of AUTHOR_ATTRIBUTES) {
            row.querySelectorAll(`[${attr}]`).forEach(el => {
                const value = el.getAttribute(attr)!;
                if (!isStableAttributeValue(attr, value)) return;
                const key = cssAttr(attr, value);
                if (el.parentElement?.closest(key) && row.contains(el.parentElement.closest(key))) return;
                perRow.set(key, (perRow.get(key) ?? 0) + 1);
            });
        }
        perRow.forEach((n, key) => { if (n >= 2) counts.set(key, (counts.get(key) ?? 0) + 1); });
    }
    return [...counts.entries()].filter(([, rowsWithRepeats]) => rowsWithRepeats >= MIN_ROWS_REPEATING).map(([key]) => key);
}

interface Occurrence { el: Element; row: number; text: string; pos: number }

/** Elements from the row's child down to `el`'s parent. */
function ancestors(el: Element, row: Element): Element[] {
    const out: Element[] = [];
    for (let p = el.parentElement; p && p !== row; p = p.parentElement) out.unshift(p);
    return out;
}

/**
 * The selector of one place: the hook under the nearest ancestor whose step tells this place from
 * the others in every row, else the hook alone (one place), else the full path.
 */
function placeSelector(hook: string, own: Occurrence[], all: Occurrence[], rows: Element[]): string {
    const path = ancestors(own[0].el, rows[own[0].row]);
    const want = new Set(own.map(o => o.el));
    const exact = (sel: string) => rows.every((row, r) => {
        const matched = query(row, sel);
        return matched.length === all.filter(o => o.row === r && want.has(o.el)).length && matched.every(el => want.has(el));
    });
    if (exact(hook)) return hook;
    for (let i = path.length - 1; i >= 0; i--) {
        const sel = `${nodeStep(path[i]).css} ${hook}`;
        if (exact(sel)) return sel;
    }
    return `:scope > ${[...path.map(e => nodeStep(e).css), hook].join(' > ')}`;
}

/** Groups a place's phrases into kinds; each kind is the rows its phrases appear in and its words. */
function kindsOf(occ: Occurrence[]): { rows: Set<number>; words: string[]; lead: Set<string>; texts: Set<string>; pos: number[] }[] {
    // Start with one kind per phrase template (numbers aside: "12 mins" and "13 mins" are one).
    const byTemplate = new Map<string, Occurrence[]>();
    occ.forEach(o => {
        const t = o.text.toLowerCase().replace(/\d+/g, '#');
        byTemplate.set(t, [...(byTemplate.get(t) ?? []), o]);
    });
    const kinds = [...byTemplate.values()].map(list => {
        const words = phraseWords(list[0].text);
        return { rows: new Set(list.map(o => o.row)), words, lead: new Set(words.slice(0, 1)), texts: new Set(list.map(o => o.text)), pos: list.map(o => o.pos) };
    });
    const linked = (a: typeof kinds[0], b: typeof kinds[0]) =>
        [...a.lead].some(w => b.words.includes(w)) || [...b.lead].some(w => a.words.includes(w));
    const apart = (a: typeof kinds[0], b: typeof kinds[0]) => ![...a.rows].some(r => b.rows.has(r));
    for (let merged = true; merged;) {
        merged = false;
        outer: for (let i = 0; i < kinds.length; i++) {
            for (let j = i + 1; j < kinds.length; j++) {
                const a = kinds[i], b = kinds[j];
                if (!apart(a, b) || !linked(a, b)) continue;
                b.rows.forEach(r => a.rows.add(r));
                b.words.forEach(w => { if (!a.words.includes(w)) a.words.push(w); });
                b.lead.forEach(w => a.lead.add(w));
                b.texts.forEach(t => a.texts.add(t));
                a.pos.push(...b.pos);
                kinds.splice(j, 1);
                merged = true;
                break outer;
            }
        }
    }
    // Reading order: where in the place the kind usually sits.
    const mean = (p: number[]) => p.reduce((s, x) => s + x, 0) / p.length;
    return kinds.sort((a, b) => mean(a.pos) - mean(b.pos));
}

/**
 * A kind's name: its phrase when it has one short one without numbers ("Low stock"), else the word
 * most of its phrases share ("Shipping"); "" when they share none (flags: "Best seller", "Clearance").
 */
function kindLabel(texts: Set<string>, occ: Occurrence[]): string {
    const title = (ws: string[]) => ws.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const distinct = [...new Set([...texts].map(t => phraseWords(t).join(' ')))];
    if (distinct.length === 1 && distinct[0].split(' ').length <= 3 && ![...texts].some(t => /\d/.test(t))) return title(distinct[0].split(' '));
    const freq = new Map<string, number>();
    occ.forEach(o => new Set(phraseWords(o.text)).forEach(w => freq.set(w, (freq.get(w) ?? 0) + 1)));
    const firstAt = (w: string) => Math.min(...occ.map(o => { const i = phraseWords(o.text).indexOf(w); return i < 0 ? 99 : i; }));
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || firstAt(a[0]) - firstAt(b[0]))[0];
    return top && top[1] * 2 >= occ.length ? title([top[0]]) : '';
}

/**
 * Replaces the text fields that lie wholly inside a repeated hook, when they are its fragments (one
 * selector split into slots), with fields reading each occurrence whole (`cell`): one per place, or
 * one per kind in a place that holds several per card. Other fields are untouched.
 */
export function collapseComponents(fields: Field[], rows: Element[]): Field[] {
    let out = fields;
    for (const hook of repeatedHooks(rows)) {
        const inside = (f: Field) => TEXTUAL.has(f.attr) && f.atoms.length > 0 && f.atoms.every(a => a.el.closest(hook));
        const parts = out.filter(inside);
        // Fragments: one selector split into position slots. Distinct fields that merely share a
        // repeated wrapper (Amazon's reviews and badge inside `s-client-side-analytics`) stay apart.
        const slotsBySelector = new Map<string, number>();
        parts.filter(p => p.slot !== undefined).forEach(p => slotsBySelector.set(p.selector, (slotsBySelector.get(p.selector) ?? 0) + 1));
        if (![...slotsBySelector.values()].some(n => n >= 2)) continue;

        const occ: Occurrence[] = [];
        rows.forEach((row, r) => {
            Array.from(row.querySelectorAll(hook)).forEach(el => {
                const text = readValue(el, 'cell');
                if (text) occ.push({ el, row: r, text, pos: occ.filter(o => o.row === r).length });
            });
        });
        // Places: the occurrence's path in the card, by stable node labels.
        const byPlace = new Map<string, Occurrence[]>();
        occ.forEach(o => {
            const key = ancestors(o.el, rows[o.row]).map(e => nodeStep(e).label).join('>');
            byPlace.set(key, [...(byPlace.get(key) ?? []), o]);
        });

        const built: Field[] = [];
        for (const own of byPlace.values()) {
            const selector = placeSelector(hook, own, occ, rows);
            const perRow = new Map<number, number>();
            own.forEach(o => perRow.set(o.row, (perRow.get(o.row) ?? 0) + 1));
            const several = Math.max(...perRow.values()) > 1;
            const kinds = several ? kindsOf(own) : [];
            const words = kinds.map(k => k.words);
            const groups = several
                ? kinds.map((k, i) => ({ kind: i, label: kindLabel(k.texts, own.filter(o => kindOf(o.text, words) === i)), list: own.filter(o => kindOf(o.text, words) === i) }))
                // A place of its own is named by its words when they agree; the hook names the rest.
                : [{ kind: undefined, label: byPlace.size > 1 ? kindLabel(new Set(own.map(o => o.text)), own) : '', list: own }];
            for (const g of groups) {
                const values = new Map<number, string>();
                const atoms: Atom[] = [];
                g.list.forEach(o => {
                    if (values.has(o.row)) return;
                    values.set(o.row, o.text);
                    atoms.push({ el: o.el, attr: 'cell', value: o.text, sig: `${selector}@cell`, path: [o.el] });
                });
                if (atoms.length === 0) continue;
                // Where the kind sits among the row's values, as `order` is for every other field.
                const order = Math.min(...atoms.map((a, i) => {
                    const r = [...values.keys()][i];
                    const k = collectAtoms(rows[r]).findIndex(x => a.el.contains(x.el));
                    return k < 0 ? 1e9 : k;
                }));
                built.push({
                    key: `${selector}@cell${g.kind !== undefined ? `~${g.kind}` : ''}`, attr: 'cell', selector, values, atoms,
                    shape: shapeOf(atoms[0].value, 'cell'), order,
                    ...(g.kind !== undefined ? { kinds: words, kind: g.kind } : {}),
                    ...(g.label ? { label: g.label } : {}),
                });
            }
        }
        out = [...out.filter(f => !inside(f)), ...built];
    }
    return out;
}
