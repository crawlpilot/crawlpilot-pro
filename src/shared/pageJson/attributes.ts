/**
 * The attributes of an item or of a list's items, for a person to tick: each value's key (relative to
 * the item), a sample, how many items fill it, its type, and whether it is worth reading by default.
 */
import { detectType } from '../transforms/detect';
import type { FieldType } from '../transforms/chain';
import { isNoiseKey } from './noise';
import { LABEL_KEYS, cellText, readKey, spellable } from './path';

export interface JsonAttribute {
    /** Read relative to the item (`offers.price`, `images[*].url`, `specs[name=Color].value`). */
    key: string;
    /** The column name offered (editable). */
    name: string;
    sample: string;
    /** Share of items that have it (0–1); 1 or 0 for a single item. */
    fill: number;
    type: FieldType;
    /** Several values per item (a list column). */
    many: boolean;
    /** Ticked by default. */
    suggested: boolean;
}

const MAX_DEPTH = 4;
const MAX_ATTRIBUTES = 250;
const MAX_SUGGESTED = 12;
const SAMPLED_ITEMS = 100;
/** Distinct labels of a name → value list offered one by one (`specs[name=Color].value`). */
const MAX_LABELS = 30;
const SKIP = new Set(['@context', '@id', '@type']);
/** Keys of internal bookkeeping, not data people want by default. */
const INTERNAL = /(^|_)(uuid|guid|hash|token|cursor|tracking|typename|cache)($|_)|^__/i;
const VALUE_KEYS = ['value', 'values', 'text', 'content'];
/** Last keys that say little on their own: `brand.name` is "brand name", not "name". */
const VAGUE = new Set(['value', 'text', 'name', 'url', 'id', 'amount', '@value', 'content', 'src', 'href', 'label', 'title']);

/** Names of what people extract. */
const DATA_WORDS = /(name|title|headline|price|amount|currency|brand|url|link|href|image|photo|thumbnail|rating|score|review|count|description|summary|text|sku|gtin|mpn|model|category|author|date|time|published|posted|location|address|city|country|company|salary|availability|stock|condition|color|size)/i;
/** The few every record is known by. */
const CORE_WORDS = /^(name|title|headline|price|url|image|brand|rating|description)$/i;
/** Names of switches and codes: `showAtc`, `enableX`, `isEligible`, `canAddToList`. */
const FLAG_WORDS = /^(show|hide|enable|disable|is|can|has|should|allow|use)[A-Z_]|eligib|(^|[a-z])(Id|ID|Ids|Type|Code|Key|Version|Flag)s?$/;

/** How much an attribute looks like data a person wants (≤ 0: not suggested). */
function interest(a: JsonAttribute): number {
    const last = a.key.replace(/\[\*\]/g, '').split('.').pop() ?? '';
    if (a.type === 'boolean' || /^(true|false)$/.test(a.sample)) return 0;
    if (FLAG_WORDS.test(last)) return 0;
    return 1 + (CORE_WORDS.test(last) ? 1.5 : 0) + (DATA_WORDS.test(last) ? 2 : 0) + (a.type !== 'text' ? 0.5 : 0) - a.key.split('.').length * 0.2;
}

const isScalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A name → value list (`[{name: "Color", value: "Red"}, …]`): its label key and value key. */
function pairKeys(list: unknown[]): { label: string; value: string } | null {
    const objs = list.filter(isPlain);
    if (objs.length < 2 || objs.length < list.length * 0.8) return null;
    const label = LABEL_KEYS.find(k => objs.every(o => typeof o[k] === 'string'));
    const value = label && VALUE_KEYS.find(k => objs.filter(o => isScalar(o[k])).length >= objs.length * 0.8);
    return label && value ? { label, value } : null;
}

/** Keys of one item's values, in document order. */
function keysOf(item: Record<string, unknown>, out: Set<string>, prefix = '', depth = 0) {
    for (const [k, v] of Object.entries(item)) {
        if (out.size >= MAX_ATTRIBUTES * 2) return;
        if (SKIP.has(k) || isNoiseKey(k) || !spellable(k) || v === null || v === undefined || v === '') continue;
        const key = prefix ? `${prefix}.${k}` : k;
        if (isScalar(v)) { out.add(key); continue; }
        if (Array.isArray(v)) {
            if (v.length === 0) continue;
            if (v.every(x => x === null || isScalar(x))) { out.add(key); continue; }
            const pairs = pairKeys(v);
            if (pairs) {
                for (const o of v.filter(isPlain).slice(0, MAX_LABELS)) {
                    const label = String(o[pairs.label]);
                    if (spellable(label)) out.add(`${key}[${pairs.label}=${label}].${pairs.value}`);
                }
                continue;
            }
            const first = v.find(isPlain);
            if (!first) continue;
            // One level of an array of objects, each scalar key as a list (`images[*].url`).
            for (const [sk, sv] of Object.entries(first)) {
                if (isScalar(sv) && !SKIP.has(sk) && !isNoiseKey(sk) && spellable(sk)) out.add(`${key}[*].${sk}`);
            }
            continue;
        }
        if (isPlain(v) && depth < MAX_DEPTH) keysOf(v, out, key, depth + 1);
    }
}

const words = (k: string) => k.replace(/^@/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().trim();

/** `offers.price` → "price", `brand.name` → "brand name", `specs[name=Color].value` → "color". */
export function attributeName(key: string): string {
    const pick = /\[[^=\]]+=([^\]]+)\]/.exec(key);
    if (pick) return words(pick[1]);
    const segs = key.replace(/\[\*\]/g, '').split('.');
    const last = segs[segs.length - 1];
    const prev = segs[segs.length - 2];
    return words(VAGUE.has(last) && prev ? `${prev} ${last}` : last);
}

/** Names made distinct: a repeat takes its parent key in front ("offers price", "list price"). */
function distinctNames(keys: string[]): string[] {
    const names = keys.map(attributeName);
    const seen = new Map<string, number>();
    return names.map((n, i) => {
        const count = names.filter(x => x === n).length;
        if (count === 1) return n;
        const segs = keys[i].replace(/\[[^\]]*\]/g, '').split('.');
        const longer = words(segs.slice(-2).join(' '));
        const k = seen.get(longer) ?? 0;
        seen.set(longer, k + 1);
        return k ? `${longer} ${k + 1}` : longer;
    });
}

/** The attributes of these items (one item for a single record), most useful first among the suggested. */
export function attributesOf(items: unknown[]): JsonAttribute[] {
    const rows = items.filter(isPlain).slice(0, SAMPLED_ITEMS);
    if (rows.length === 0) return [];
    const keys = new Set<string>();
    rows.slice(0, 20).forEach(r => keysOf(r, keys));
    const list = [...keys].slice(0, MAX_ATTRIBUTES);
    const names = distinctNames(list);

    const attrs = list.map((key, i): JsonAttribute => {
        const values = rows.map(r => readKey(r, key));
        const cells = values.map(cellText);
        const filled = cells.filter(Boolean);
        const many = key.includes('[*]') || values.some(Array.isArray);
        const detected = detectType(many ? values.flatMap(v => (Array.isArray(v) ? v : [v])) : filled, names[i]);
        const sample = filled[0] ?? '';
        return {
            key, name: names[i],
            sample: sample.length > 80 ? `${sample.slice(0, 80)}…` : sample,
            fill: filled.length / rows.length,
            type: detected.type, many,
            suggested: false,
        };
    });

    // Suggested: what most items have, not bookkeeping, not a name → value entry; the dozen that look
    // most like data (a name, a price, a link) before flags and codes, shown in their own order.
    const floor = rows.length === 1 ? 1 : 0.8;
    attrs
        .filter(a => a.fill >= floor && !INTERNAL.test(a.key.split('.').pop() ?? '') && !/\[[^*\]]+\]/.test(a.key) && a.sample.length <= 500)
        .map((a, i) => ({ a, interest: interest(a) - i * 0.01 }))
        .filter(x => x.interest > 0)
        .sort((x, y) => y.interest - x.interest)
        .slice(0, MAX_SUGGESTED)
        .forEach(({ a }) => { a.suggested = true; });
    return attrs;
}
