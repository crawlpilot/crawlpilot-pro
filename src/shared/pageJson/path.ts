/**
 * Paths into a page's JSON that hold on other pages of the site, and the attribute keys read inside
 * an item. A path is a list of steps (a key, an index, or "the array item whose `where` is `is`").
 * An attribute key is a short text read relative to an item:
 *
 * - `offers.price`: keys, dot-separated;
 * - `images[*]`, `images[*].url`: every item of an array (a list of values);
 * - `additionalProperty[name=Color].value`: the array item whose `name` is `Color`.
 *
 * Keys a key text cannot spell (with `.`, `[`, `]` or `=`) are left out rather than written wrong.
 */
import type { JsonStep } from '../types/database';

/** Keys that are labels of an object in a list ("name": "Btu"), tried first to choose an item. */
export const LABEL_KEYS = ['name', 'label', 'key', 'title', 'displayName', 'attribute', 'attributeName', 'type'];

/** A key that is one item's own ID, not a name the next page also has. */
export const idLike = (k: string) => /\d{5,}/.test(k) || (k.length >= 8 && /\d/.test(k) && /^[A-Z0-9_-]+$/.test(k));

/** A key an attribute key can spell. */
export const spellable = (k: string) => k.length > 0 && !/[.[\]=]/.test(k);

export function at(data: unknown, path: (string | number)[]): unknown {
    let cur: any = data;
    for (const k of path) { if (cur == null) return undefined; cur = cur[k]; }
    return cur;
}

export function follow(data: unknown, path: JsonStep[]): unknown {
    let cur: any = data;
    for (const step of path) {
        if (cur == null) return undefined;
        if (typeof step === 'object') cur = Array.isArray(cur) ? cur.find(o => o?.[step.where] === step.is) : undefined;
        else cur = cur[step];
    }
    return cur;
}

/**
 * A raw path made to hold on other pages: each array index becomes "the item whose label is …" when
 * the items have a label key telling them apart; an index stays an index otherwise. Null when a key
 * is an item's own ID.
 */
export function stablePath(data: unknown, raw: (string | number)[]): JsonStep[] | null {
    const out: JsonStep[] = [];
    for (let i = 0; i < raw.length; i++) {
        const k = raw[i];
        if (typeof k === 'string') {
            if (idLike(k)) return null;
            out.push(k);
            continue;
        }
        const list = at(data, raw.slice(0, i)) as unknown[];
        const item = list[k] as Record<string, unknown> | undefined;
        const label = item && typeof item === 'object' && !Array.isArray(item)
            ? LABEL_KEYS.find(key => typeof item[key] === 'string' && list.filter(o => (o as any)?.[key] === item[key]).length === 1)
            : undefined;
        out.push(label ? { where: label, is: item![label] as string } : k);
    }
    return out;
}

/** `props.pageProps.items`, `specs[name=Color]`: a path as people read it. */
export function formatSteps(path: JsonStep[]): string {
    return path.map((s, i) => typeof s === 'number' ? `[${s}]` : typeof s === 'object' ? `[${s.where}=${s.is}]` : `${i ? '.' : ''}${s}`).join('');
}

type KeySeg = { key: string; pick?: '*' | { where: string; is: string } };

function parseKey(text: string): KeySeg[] {
    const segs: KeySeg[] = [];
    let i = 0;
    while (i < text.length) {
        let key = '';
        while (i < text.length && text[i] !== '.' && text[i] !== '[') key += text[i++];
        const seg: KeySeg = { key };
        if (text[i] === '[') {
            const end = text.indexOf(']', i);
            const inner = text.slice(i + 1, end < 0 ? text.length : end);
            i = end < 0 ? text.length : end + 1;
            const eq = inner.indexOf('=');
            seg.pick = inner === '*' ? '*' : eq > 0 ? { where: inner.slice(0, eq), is: inner.slice(eq + 1) } : undefined;
        }
        if (text[i] === '.') i++;
        segs.push(seg);
    }
    return segs;
}

/** The value of an attribute key inside an item: an array when the key has `[*]`. */
export function readKey(item: unknown, key: string): unknown {
    const read = (cur: unknown, segs: KeySeg[]): unknown => {
        if (segs.length === 0) return cur;
        if (cur == null || typeof cur !== 'object') return undefined;
        const [seg, ...rest] = segs;
        let v: any = seg.key ? (cur as any)[seg.key] : cur;
        if (!seg.pick) return read(v, rest);
        if (!Array.isArray(v)) return undefined;
        if (seg.pick === '*') return v.flatMap(x => { const r = read(x, rest); return r === undefined || r === null ? [] : Array.isArray(r) ? r : [r]; });
        const { where, is } = seg.pick;
        v = v.find(o => o && typeof o === 'object' && String((o as any)[where]) === is);
        return read(v, rest);
    };
    return read(item, parseKey(key));
}

/** A read value as a cell: lists joined with ", ", objects as JSON, nothing as ''. */
export function cellText(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(cellText).filter(Boolean).join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v).trim();
}
