/**
 * Stage 3b: one value, several fields (`docs/plans/generic-list-selectors-plan.md` §3.3). A field
 * whose values share a template across rows is split into its slots:
 *
 *     "4.4 out of 5 Stars. 510 reviews"  → rating 4.4, review count 510
 *     "(4.4 / 1949)"                     → rating 4.4, review count 1949
 *     "Model# H300MTS"                   → model H300MTS
 *     "At Your Store: 16 in stock"       → stock 16
 *     "Delivery: Unavailable in Guam"    → delivery "Unavailable in Guam"
 *     "Display Size; 14 inches; RAM; 4 GB" (a list of label/value pairs) → display size, RAM
 *
 * The template is learned from the values: they are tokenised (numbers, codes, words, punctuation),
 * the most common token sequence is the template, and the numbers and codes that change from row to
 * row are its slots. Each slot becomes a field that reads the same element and takes its slot with a
 * pattern stored on the reader, so a run reads exactly what inference read. Slots are named by the
 * words around them, and by their values when there are none. The whole value stays a field unless
 * the template explains nearly every row.
 *
 * No site knowledge: the only vocabulary is a short list of words about ratings, reviews, prices and
 * stock, in `MEANINGS`.
 */
import { shapeOf } from '../atoms';
import { Field, TEXTUAL } from './types';

export type Derive = { pattern: string; group: number } | { pair: string };

const MIN_ROWS = 3;
/** Share of a field's values the template must fit. */
const TEMPLATE_SHARE = 0.6;
/** Share above which the whole value is dropped: the template explains it. */
const EXPLAINED = 0.9;
const MAX_LENGTH = 120;
/** Above this average length a value is prose (a title, a description), never split. */
const PROSE = 60;

const NUM = String.raw`(?:[\p{Sc}]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?[KkMm]\b)?\+?`;
const CODE = String.raw`[\p{L}\p{N}#]*\d[\p{L}\p{N}#]*(?:[-/][\p{L}\p{N}]+)*`;
/** A code joined by dashes or slashes ("2626-20", "A-76/B"): one token, not number, dash, number. */
const JOINED = String.raw`[\p{L}\p{N}]*\d[\p{L}\p{N}]*(?:[-/][\p{L}\p{N}]+)+`;
const TOKEN = new RegExp(String.raw`(${JOINED})|(${NUM})|([\p{L}\p{N}#'’]+)|([^\s\p{L}\p{N}])`, 'gu');

interface Token { text: string; kind: 'num' | 'code' | 'word' | 'punct' }

function tokens(value: string): Token[] {
    const out: Token[] = [];
    for (const m of value.matchAll(TOKEN)) {
        if (m[1]) out.push({ text: m[1], kind: 'code' });
        else if (m[2]) out.push({ text: m[2].trim(), kind: 'num' });
        else if (m[3]) out.push({ text: m[3], kind: /\d/.test(m[3]) && /\p{L}/u.test(m[3]) ? 'code' : 'word' });
        else out.push({ text: m[4], kind: 'punct' });
    }
    return out;
}

const signature = (ts: Token[]) => ts.map(t => (t.kind === 'num' ? '#N' : t.kind === 'code' ? '#C' : t.text.toLowerCase())).join(' ');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words that say what a number next to them is. */
const MEANINGS: { label: string; before?: RegExp; after?: RegExp }[] = [
    { label: 'Rating', after: /^(out of|stars?\b)/, before: /\b(rating|rated)$/ },
    { label: 'Review Count', after: /^(reviews?|ratings?)\b/ },
    { label: 'Was Price', before: /\b(was|list( price)?|regular|reg|original|msrp|rrp)$/ },
    { label: 'Typical Price', before: /\btypical$/ },
    { label: 'Savings', before: /\b(save|savings|you save)$/, after: /^off\b/ },
    { label: 'From Price', before: /\b(from|starting at|as low as)$/ },
    { label: 'Price', before: /\b(now|price|current price|sale|our price)$/ },
    { label: 'Stock', after: /^(in stock|left)\b/, before: /\bonly$/ },
    { label: 'Model', before: /\bmodel( ?#| number| no)?$/ },
    { label: 'SKU', before: /\b(sku|item ?#?)$/ },
];

function title(words: string): string {
    return words.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).slice(-3).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** A name for slot `i` of `template` from the words around it, else from its values. */
function slotName(template: Token[], at: number, slots: number[], values: string[]): string | undefined {
    const words = (from: number, to: number) => template.slice(from, to).filter(t => t.kind === 'word').map(t => t.text.toLowerCase()).join(' ');
    const prev = slots.filter(s => s < at).pop() ?? -1;
    const next = slots.find(s => s > at) ?? template.length;
    const before = words(prev + 1, at);
    const after = words(at + 1, next);
    for (const m of MEANINGS) if ((m.before && m.before.test(before)) || (m.after && m.after.test(after))) return m.label;
    // No words: what the values look like. A decimal up to 5 is a rating; a whole number right after one is its review count.
    const nums = values.map(v => Number(v.replace(/[^\d.]/g, ''))).filter(n => !Number.isNaN(n));
    if (nums.length && nums.every(n => n <= 5) && nums.some(n => !Number.isInteger(n))) return 'Rating';
    if (prev >= 0 && template[prev].kind === 'num' && nums.length && nums.every(Number.isInteger)) return 'Review Count';
    // "from $199 – $390": the end of a range.
    if (prev >= 0 && !before && /^[-–—]$|^to$/i.test(template[at - 1].text) && slotName(template, prev, slots, []) === 'From Price') return 'To Price';
    if (before) return title(before);
    return undefined;
}

/** A derived field: the source's element and attribute, one slot of its values. */
function derived(source: Field, derive: Derive, values: Map<number, string>, label: string | undefined, i: number): Field {
    const sample = [...values.values()];
    return {
        ...source,
        key: `${source.key}#${i}`,
        values,
        derive,
        label,
        shape: sample.length ? (sample.map(v => shapeOf(v)).sort().find((s, _, all) => all.filter(x => x === s).length > all.length / 2) ?? 'text') : 'text',
        many: false,
        alts: undefined,
    };
}

/** Reads a derived value out of the source's value (the same at inference and on every run). */
export function applyDerive(value: string | undefined, d: Derive): string | undefined {
    if (value === undefined) return undefined;
    if ('pair' in d) {
        const parts = value.split('; ');
        const i = parts.findIndex(p => p.toLowerCase() === d.pair.toLowerCase());
        return i >= 0 && parts[i + 1] ? parts[i + 1] : undefined;
    }
    const m = new RegExp(d.pattern, 'iu').exec(value);
    return m?.[d.group]?.trim() || undefined;
}

/** Slots of a numeric/code template, or a "Label: text" prefix. */
function splitTemplate(f: Field): Field[] {
    const values = [...f.values.entries()];
    const byRow = values.map(([row, v]) => ({ row, v, ts: tokens(v) }));
    const counts = new Map<string, number>();
    for (const x of byRow) counts.set(signature(x.ts), (counts.get(signature(x.ts)) ?? 0) + 1);
    const [sig, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
    const out: Field[] = [];

    if (count >= values.length * TEMPLATE_SHARE) {
        const fitting = byRow.filter(x => signature(x.ts) === sig);
        const template = fitting[0].ts;
        // Numbers and codes that change between rows are slots; the same "5" in "out of 5" is not.
        const slots = template.map((_, i) => i).filter(i => (template[i].kind === 'num' || template[i].kind === 'code')
            && new Set(fitting.map(x => x.ts[i].text)).size > 1);
        // The pattern: constants as written (spacing free), slots captured.
        const pattern = template.map((t, i) => (slots.includes(i) ? `(${t.kind === 'num' ? NUM : CODE})` : escape(t.text))).join(String.raw`\s*`);
        const parts = slots.map((at, k) => {
            const d: Derive = { pattern, group: k + 1 };
            const vals = new Map<number, string>();
            for (const [row, v] of values) { const x = applyDerive(v, d); if (x) vals.set(row, x); }
            return { at, d, vals, name: slotName(template, at, slots, [...vals.values()]) };
        });
        // Split only with evidence that the parts are separate values: a known meaning for one of them
        // (by its words, "out of 5", "reviews", "Was", or by its values, a decimal up to 5 beside a whole
        // number), or a label marker before a part ("Model#", "Store:"). Words and numbers alone
        // ("Lamp 3", "Size 10") are one value.
        const marked = (at: number) => at > 0 && (template[at - 1].text === ':' || /#$/.test(template[at - 1].text));
        const known = new Set([...MEANINGS.map(m => m.label)]);
        const evidence = parts.some(p => (p.name !== undefined && known.has(p.name)) || marked(p.at));
        if (slots.length > 0 && evidence) {
            parts.forEach((p, k) => { if (p.vals.size >= MIN_ROWS) out.push(derived(f, p.d, p.vals, p.name, k)); });
            return out;
        }
    }

    // "Label: free text", the same label in most rows.
    const prefixes = new Map<string, number>();
    for (const [, v] of values) { const m = /^([\p{L}][\p{L}\s]{1,30}):\s*\S/u.exec(v); if (m) prefixes.set(m[1], (prefixes.get(m[1]) ?? 0) + 1); }
    const [label, n] = [...prefixes].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (label && n >= values.length * TEMPLATE_SHARE) {
        const d: Derive = { pattern: String.raw`(?:^|;\s*)${escape(label)}\s*:\s*([^;]+)`, group: 1 };
        const vals = new Map<number, string>();
        for (const [row, v] of values) { const x = applyDerive(v, d); if (x) vals.set(row, x); }
        if (vals.size >= MIN_ROWS) out.push(derived(f, d, vals, title(label), 0));
    }
    return out;
}

/** A list of label/value pairs ("Display Size; 14 inches; RAM; 4 GB"): one field per label. */
function splitPairs(f: Field): Field[] {
    const lists = [...f.values.entries()].map(([row, v]) => [row, v.split('; ')] as const);
    const even = lists.filter(([, parts]) => parts.length >= 2 && parts.length % 2 === 0);
    if (even.length < Math.max(MIN_ROWS, lists.length * TEMPLATE_SHARE)) return [];
    // Labels: the even positions, from a small vocabulary repeated across rows.
    const labelRows = new Map<string, number>();
    for (const [, parts] of even) for (let i = 0; i < parts.length; i += 2) labelRows.set(parts[i], (labelRows.get(parts[i]) ?? 0) + 1);
    const labels = [...labelRows].filter(([, n]) => n >= Math.max(2, even.length * 0.3)).map(([l]) => l);
    const valuesRepeat = even.every(([, parts]) => parts.filter((_, i) => i % 2 === 0).every(l => labelRows.get(l)! >= 2));
    if (labels.length === 0 || !valuesRepeat) return [];
    return labels.flatMap((label, k) => {
        const d: Derive = { pair: label };
        const vals = new Map<number, string>();
        for (const [row, v] of f.values) { const x = applyDerive(v, d); if (x) vals.set(row, x); }
        return vals.size >= MIN_ROWS ? [derived(f, d, vals, title(label), k)] : [];
    });
}

/** The same values as another field, in nearly every row: a copy. */
function sameValues(a: Field, b: Field): boolean {
    let both = 0, equal = 0;
    for (const [row, v] of a.values) {
        const w = b.values.get(row);
        if (w === undefined) continue;
        both++;
        // The same text, or the same number written with words around it ("$799.99" and "Was $799.99").
        const digits = (x: string) => x.replace(/\D/g, '');
        if (w.trim().toLowerCase() === v.trim().toLowerCase() || (digits(v) !== '' && digits(v) === digits(w))) equal++;
    }
    return both >= MIN_ROWS && equal / both >= 0.9;
}

export function splitFields(fields: Field[]): Field[] {
    const out: Field[] = [];
    for (const f of fields) {
        if (!TEXTUAL.has(f.attr) || f.values.size < MIN_ROWS || f.derive) { out.push(f); continue; }
        const vals = [...f.values.values()];
        // Titles and descriptions are text, not values with parts ("Laptop model 2 with 8GB RAM").
        const prose = vals.some(v => v.length > MAX_LENGTH) || vals.reduce((n, v) => n + v.length, 0) / vals.length > PROSE
            || f.atoms.some(a => a.el.closest('h1, h2, h3, h4, h5, h6'));
        const long = prose;
        const parts = f.many ? splitPairs(f) : long ? [] : splitTemplate(f);
        if (parts.length === 0) { out.push(f); continue; }
        // The whole value stays when the parts leave rows unexplained: a template some rows don't fit,
        // or a list with labels that never became a field.
        const covered = new Set(parts.flatMap(p => [...p.values.keys()]));
        const labels = new Set(parts.map(p => (p.derive && 'pair' in p.derive ? p.derive.pair : '')));
        const listExplained = f.many && [...f.values.values()].every(v => v.split('; ').every((x, i) => i % 2 === 1 || labels.has(x)));
        if (f.many ? !listExplained : covered.size < f.values.size * EXPLAINED) out.push(f);
        out.push(...parts);
    }
    // A derived value another field already holds (the same rating from a visual copy and a sentence)
    // is kept once: the copy with as many rows wins, the earlier one on a tie.
    // Its meaning passes to the copy kept, when that has none (a visual "$159.95" is the was price
    // the sentence "Was $159.95" named).
    return out.filter((f, i) => {
        if (!f.derive) return true;
        const kept = out.find((g, j) => g !== f && sameValues(f, g)
            && (g.values.size > f.values.size || (g.values.size === f.values.size && (!g.derive || j < i))));
        if (kept && !kept.label && f.label) kept.label = f.label;
        return !kept;
    });
}
