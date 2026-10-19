/**
 * Stage 3: one field per thing. The same value under two selectors is one field; the same kind of
 * value that never shares a row with another is that field in a different card layout.
 */
import { nodeStep } from '../nodeName';
import { AUTHOR_ATTRIBUTES } from '../../../../shared/selectors/stability';
import { HTML_TAGS } from './name';
import { Field, norm } from './types';

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

const isHook = (el: Element) => AUTHOR_ATTRIBUTES.some(attr => el.getAttribute(attr) === nodeStep(el).label);

/** The labels of the hooked elements on a field's path (row child to the element), and how far up the nearest is. */
function hooks(f: Field): { labels: string[]; up: number } {
    const chain = [...f.atoms[0].path, f.atoms[0].el];
    const hooked = chain.filter(isHook);
    const nearest = hooked[hooked.length - 1];
    return { labels: hooked.map(el => nodeStep(el).label), up: nearest ? chain.length - 1 - chain.lastIndexOf(nearest) : Infinity };
}

/**
 * The two fields sit in the same named part of the card: the same nearest hook, or one's own
 * element (or its parent) is a hook on the other's path (Walmart's plain price,
 * `unified-global-product-price`, around the sale price's `ugpp-reduced-price`). Without hooks on
 * both, nothing tells the parts apart, so they may be (`.price` and `.deal-price`). A rating digit
 * in the reviews block and a "+2" whose nearest hook is the whole card body are not one field
 * however rarely they meet.
 */
function samePlace(a: Field, b: Field): boolean {
    const ha = hooks(a);
    const hb = hooks(b);
    if (ha.labels.length === 0 || hb.labels.length === 0) return true;
    const na = ha.labels[ha.labels.length - 1];
    const nb = hb.labels[hb.labels.length - 1];
    return na === nb || (ha.up <= 1 && hb.labels.includes(na)) || (hb.up <= 1 && ha.labels.includes(nb));
}

/** Never in the same row, same kind of value, same part of the card: one field in two card layouts. */
function variantOf(a: Field, b: Field): boolean {
    if (a.attr !== b.attr || a.shape !== b.shape || a.many !== b.many) return false;
    // A component's kinds are told apart by their words, never by the rows they're in.
    if (a.kinds || b.kinds) return false;
    for (const r of b.values.keys()) if (a.values.has(r)) return false;
    if (!samePlace(a, b)) return false;
    if (a.shape !== 'text') return true;
    const leaf = (f: Field) => nodeStep(f.atoms[0].el).label;
    return leaf(a) === leaf(b) && !HTML_TAGS.has(leaf(a));
}

/** Fields come best first; a later duplicate is dropped, a later variant becomes an alternate reader. */
export function mergeFields(fields: Field[]): Field[] {
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
    return merged;
}
