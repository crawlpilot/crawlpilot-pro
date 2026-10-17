/**
 * Structured data first (after thenos `selector-agent/rows.py` step 1, design only: "if the data is
 * already in the page's JSON, do not guess it from the DOM"). When the page's JSON-LD or embedded
 * state (`__NEXT_DATA__`, JSON scripts) holds an array whose items are the list's rows, its keys
 * become named fields with no guessing.
 *
 * The run stays row-driven: each DOM row is matched to its JSON item by an anchor (the item's URL or
 * name, found in the row), and the field reads that item. So pagination, auto-scroll and bulk runs
 * need nothing new, and each row still comes from what the page shows.
 */
import { shapeOf } from './atoms';

export type JsonPath = (string | number)[];

export interface JsonSpec {
    kind: 'ld' | 'json';
    /** Where the array is, inside one source. */
    path: JsonPath;
    /** Dotted path, inside an item, of the value that identifies the item in its DOM row. */
    anchor: string;
    /** Dotted path, inside an item, of this field's value. */
    key: string;
    anchorIsUrl: boolean;
}

export interface StructuredSource {
    kind: 'ld' | 'json';
    label: string;
    path: JsonPath;
    anchor: string;
    anchorIsUrl: boolean;
    fields: { key: string; name: string; type: string }[];
    matched: number;
    sampled: number;
}

const MAX_DEPTH = 8;
const MAX_FIELD_DEPTH = 4;
const SKIP_KEYS = new Set(['@context', '@type', '@id', 'position', '__typename']);

// ------------------------------------------------------------------------------------- sources

interface Source { kind: 'ld' | 'json'; label: string; data: unknown }

function parse(text: string): unknown {
    try { return JSON.parse(text.trim()); } catch { return undefined; }
}

let cache: { stamp: string; sources: Source[] } | null = null;

/** The page's JSON sources, parsed once per change of the page's data scripts. */
export function pageSources(doc: Document = document): Source[] {
    const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"], script[type="application/json"], script#__NEXT_DATA__'));
    const stamp = scripts.map(s => (s.textContent || '').length).join(',');
    if (cache && cache.stamp === stamp) return cache.sources;
    const sources: Source[] = [];
    for (const s of scripts) {
        const text = s.textContent || '';
        const isLd = s.getAttribute('type') === 'application/ld+json';
        if (!isLd && text.length < 200) continue; // config flags, not data
        const data = parse(text);
        if (data !== undefined) sources.push({ kind: isLd ? 'ld' : 'json', label: isLd ? 'JSON-LD' : (s.id || 'JSON script'), data });
    }
    cache = { stamp, sources };
    return sources;
}

function at(data: unknown, path: JsonPath): unknown {
    let cur: any = data;
    for (const k of path) {
        if (cur == null) return undefined;
        cur = cur[k as any];
    }
    return cur;
}

export function getDotted(obj: unknown, dotted: string): unknown {
    return at(obj, dotted.split('.'));
}

/** Arrays of objects (≥ 2 items) anywhere in a source, with their paths. */
function objectArrays(data: unknown, path: JsonPath = [], out: { path: JsonPath; items: Record<string, unknown>[] }[] = []) {
    if (path.length > MAX_DEPTH || data === null || typeof data !== 'object') return out;
    if (Array.isArray(data)) {
        const objs = data.filter(d => d && typeof d === 'object' && !Array.isArray(d));
        if (objs.length >= 2 && objs.length >= data.length * 0.8) out.push({ path, items: objs as Record<string, unknown>[] });
        data.forEach((d, i) => objectArrays(d, [...path, i], out));
        return out;
    }
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) objectArrays(v, [...path, k], out);
    return out;
}

/** Scalar leaves of an item (dotted path → value); arrays of scalars count as one leaf. */
function leaves(obj: unknown, prefix = '', depth = 0, out = new Map<string, unknown>()): Map<string, unknown> {
    if (depth > MAX_FIELD_DEPTH || obj === null || typeof obj !== 'object') return out;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (SKIP_KEYS.has(k) || k.startsWith('__')) continue;
        const p = prefix ? `${prefix}.${k}` : k;
        if (v === null || v === undefined || v === '') continue;
        if (typeof v !== 'object') out.set(p, v);
        else if (Array.isArray(v)) {
            if (v.length > 0 && v.every(x => x === null || typeof x !== 'object')) out.set(p, v);
            else if (v.length > 0 && typeof v[0] === 'object') leaves(v[0], p + '.0', depth + 1, out);
        } else leaves(v, p, depth + 1, out);
    }
    return out;
}

// -------------------------------------------------------------------------------------- matching

const looksUrl = (v: string) => /^(https?:\/\/|\/)[^\s]*$/.test(v);

function urlKey(v: string): string {
    try {
        const u = new URL(v, document.baseURI);
        return (u.host + u.pathname).replace(/\/+$/, '').toLowerCase();
    } catch { return ''; }
}

function norm(s: string): string {
    return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

interface RowProbe { urls: Set<string>; text: string }

function probe(row: Element): RowProbe {
    const urls = new Set<string>();
    const links = row.tagName === 'A' ? [row] : Array.from(row.querySelectorAll('a[href]'));
    links.forEach(a => { const k = urlKey(a.getAttribute('href') || ''); if (k) urls.add(k); });
    return { urls, text: norm(row.textContent || '') };
}

function anchorMatches(p: RowProbe, value: string, isUrl: boolean): boolean {
    return isUrl ? p.urls.has(urlKey(value)) : p.text.includes(norm(value));
}

/** Index of an array's items by anchor value, for matching rows at read time. */
const indexCache = new WeakMap<object, Map<string, Map<string, Record<string, unknown>>>>();

function itemIndex(items: Record<string, unknown>[], anchor: string, isUrl: boolean): Map<string, Record<string, unknown>> {
    let byAnchor = indexCache.get(items);
    if (!byAnchor) { byAnchor = new Map(); indexCache.set(items, byAnchor); }
    let idx = byAnchor.get(anchor);
    if (!idx) {
        idx = new Map();
        for (const item of items) {
            const v = getDotted(item, anchor);
            if (typeof v === 'string' && v) idx.set(isUrl ? urlKey(v) : norm(v), item);
        }
        byAnchor.set(anchor, idx);
    }
    return idx;
}

function findArray(kind: 'ld' | 'json', path: JsonPath): Record<string, unknown>[] | undefined {
    for (const s of pageSources()) {
        if (s.kind !== kind) continue;
        const v = at(s.data, path);
        if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
    return undefined;
}

/** The JSON item behind a DOM row, if any. */
function itemFor(row: Element, spec: Pick<JsonSpec, 'kind' | 'path' | 'anchor' | 'anchorIsUrl'>): Record<string, unknown> | undefined {
    const items = findArray(spec.kind, spec.path);
    if (!items) return undefined;
    const idx = itemIndex(items, spec.anchor, spec.anchorIsUrl);
    const p = probe(row);
    if (spec.anchorIsUrl) {
        for (const u of p.urls) { const hit = idx.get(u); if (hit) return hit; }
        return undefined;
    }
    let best: Record<string, unknown> | undefined;
    let bestLen = 0;
    idx.forEach((item, key) => { if (key.length > bestLen && p.text.includes(key)) { best = item; bestLen = key.length; } });
    return best;
}

export function readJsonField(row: Element, spec: JsonSpec): string | undefined {
    const item = itemFor(row, spec);
    if (!item) return undefined;
    const v = getDotted(item, spec.key);
    if (v === null || v === undefined || v === '') return undefined;
    if (Array.isArray(v)) return v.every(x => typeof x === 'string' && looksUrl(x)) ? JSON.stringify(v) : v.join('; ');
    return String(v);
}

// ------------------------------------------------------------------------------------- finding

function fieldName(key: string): string {
    const parts = key.split('.').filter(p => !/^\d+$/.test(p) && p !== 'item');
    const last = parts[parts.length - 1] || key;
    const words = last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    return words.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function fieldType(key: string, values: unknown[]): string {
    const first = values.find(v => v !== undefined);
    if (Array.isArray(first)) return first.every(x => typeof x === 'string' && looksUrl(x)) ? 'image_array' : 'text';
    const strings = values.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String).slice(0, 10);
    if (strings.length && strings.every(looksUrl)) return /image|photo|thumb|picture|logo/i.test(key) ? 'image' : 'url';
    if (/price|amount|cost/i.test(key)) return 'price';
    const shapes = strings.map(v => shapeOf(v, 'text'));
    if (shapes.length && shapes.every(s => s === 'number' || s === 'rating' || s === 'count')) return 'number';
    if (shapes.length && shapes.every(s => s === 'date')) return 'date';
    return 'text';
}

/**
 * Finds the array of objects in the page's JSON whose items are these rows: an anchor value of each
 * item (its URL, or a name of ≥ 4 characters, unique across items) must be found in most sampled
 * rows. Returns the best match, or null.
 */
export function findStructuredSource(rowEls: Element[]): StructuredSource | null {
    const rows = rowEls.slice(0, 20);
    if (rows.length < 2) return null;
    const probes = rows.map(probe);
    let best: StructuredSource | null = null;

    for (const source of pageSources()) {
        for (const { path, items } of objectArrays(source.data)) {
            if (items.length < rows.length * 0.5) continue;
            const itemLeaves = items.map(i => leaves(i));
            const keys = new Map<string, unknown[]>();
            itemLeaves.forEach(l => l.forEach((v, k) => { const vs = keys.get(k) ?? []; vs.push(v); keys.set(k, vs); }));

            for (const [anchor, values] of keys) {
                const strings = values.filter((v): v is string => typeof v === 'string' && v.trim().length >= 4);
                if (strings.length < items.length * 0.8 || new Set(strings).size < strings.length) continue;
                const isUrl = strings.every(looksUrl);
                const used = new Set<string>();
                let matched = 0;
                for (const p of probes) {
                    const hit = strings.find(v => !used.has(v) && anchorMatches(p, v, isUrl));
                    if (hit) { used.add(hit); matched++; }
                }
                if (matched < Math.max(2, rows.length * 0.6)) continue;
                if (best && (matched < best.matched || (matched === best.matched && !isUrl))) continue;

                const fields = [...keys.entries()]
                    .filter(([, vs]) => vs.length >= items.length * 0.3)
                    .slice(0, 40)
                    .map(([key, vs]) => ({ key, name: fieldName(key), type: fieldType(key, vs) }));
                best = { kind: source.kind, label: source.label, path, anchor, anchorIsUrl: isUrl, fields, matched, sampled: rows.length };
            }
        }
    }
    if (!best) return null;

    // Unique names: a repeated last segment takes its parent ("Offers Price").
    const seen = new Map<string, number>();
    best.fields.forEach(f => seen.set(f.name, (seen.get(f.name) ?? 0) + 1));
    best.fields.forEach(f => {
        if ((seen.get(f.name) ?? 0) > 1) {
            const parts = f.key.split('.').filter(p => !/^\d+$/.test(p) && p !== 'item');
            if (parts.length > 1) f.name = `${fieldName(parts[parts.length - 2])} ${f.name}`;
        }
    });
    const used = new Set<string>();
    best.fields.forEach(f => {
        let n = f.name;
        let i = 2;
        while (used.has(n)) n = `${f.name} ${i++}`;
        used.add(n);
        f.name = n;
    });
    return best;
}
