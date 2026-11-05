/**
 * A field read way by way (`docs/design/LLD.md` §2.3), as Atlas templates are: the page sends what each way
 * read (`content/services/page/ways.ts`); here each way's matches are picked and cleaned with its own
 * steps, and the first way that gives something wins. Bidirectional marks (U+200E…) are dropped from
 * what is read first, as Atlas does. The field's own steps and checks then run on the winner (`check.ts`).
 */
import type { PageWay, WayHit } from '../../shared/types/ways';
import { applyProOps } from '../recipe/ops';
import type { Field, Identity, Way } from '../recipe/types';

const BIDI = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;
const strip = (s: string) => s.replace(BIDI, '');

const filled = (v: unknown) => v !== null && v !== undefined && v !== ''
    && !(Array.isArray(v) && v.length === 0)
    && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** The ways as the page reads them. */
export function pageWays(field: Field): PageWay[] {
    return field.ways.map(w => {
        const many = !!w.pick && w.pick !== 'first';
        const when = w.when ? { when: w.when } : {};
        if (w.kind === 'data') return { data: w.binding, ...when, ...(many ? { many } : {}) };
        return {
            selector: w.selector, read: w.read ?? 'text',
            ...(w.attr ? { attr: w.attr } : {}), ...(w.pairs ? { pairs: w.pairs } : {}), ...when,
            ...(many || w.read === 'pairs' ? { many: true } : {}),
        };
    });
}

/** One way's value from what it read: picked, then cleaned by its own steps. */
function valueOf(way: Way, hit: WayHit, base?: string): unknown {
    const clean = (v: unknown) => applyProOps(v, way.ops ?? [], base);
    if (hit.pairs) {
        const out: Record<string, string> = {};
        for (const [k, v] of hit.pairs) {
            const key = strip(k).trim();
            const value = clean(strip(v));
            if (key && typeof value === 'string') out[key] = value;
        }
        return out;
    }
    const values = hit.values.map(strip);
    switch (way.pick ?? 'first') {
        case 'all': return values.length ? clean(values) : null;
        case 'firstFilled': {
            for (const v of values) {
                const c = clean(v);
                if (filled(c)) return c;
            }
            return null;
        }
        default: return values.length ? clean(values[0]) : null;
    }
}

/** The winning way's value and its index (-1: none gave anything). */
export function resolveWays(field: Field, hits: WayHit[], base?: string): { raw: unknown; won: number } {
    for (const [i, way] of field.ways.entries()) {
        const hit = hits[i];
        if (!hit || hit.skipped) continue;
        const v = valueOf(way, hit, base);
        if (filled(v)) return { raw: v, won: i };
    }
    return { raw: null, won: -1 };
}

/**
 * The page is not the product its URL names: the id the identity patterns find in the URL differs from
 * the identity field's value (case aside). Nothing to compare (no pattern matches, the field is empty)
 * is no mismatch.
 */
export function identityMismatch(identity: Identity, url: string, value: unknown): { expected: string; found: string } | undefined {
    let expected: string | undefined;
    for (const pattern of identity.url) {
        try {
            const m = new RegExp(pattern, 'i').exec(url);
            if (m?.[0]) { expected = m[0].trim(); break; }
        } catch { /* a pattern that doesn't compile matches nothing */ }
    }
    if (!expected || !filled(value) || typeof value === 'object') return undefined;
    const found = String(value).trim();
    return found.toLowerCase() === expected.toLowerCase() ? undefined : { expected, found };
}
