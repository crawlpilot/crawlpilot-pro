/**
 * Structured data first (after thenos `selector-agent/rows.py` step 1, design only: "if the data is
 * already in the page's JSON, do not guess it from the DOM"). When the page's JSON-LD or embedded
 * state (`__NEXT_DATA__`, JSON scripts) holds an array whose items are the list's rows, its keys
 * become named fields with no guessing.
 *
 * The run stays row-driven: each DOM row is matched to its JSON item by an anchor (the item's ID in
 * the row's `data-*` attributes or link, its URL, or its name, found in the row), and the field reads
 * that item. So pagination, auto-scroll and bulk runs
 * need nothing new, and each row still comes from what the page shows.
 */
import { atomScope, readValue, shapeOf } from './atoms';
import { requestNetEntries } from '../../features/network/NetworkRelay';

export type JsonPath = (string | number)[];

export type SourceKind = 'ld' | 'json' | 'state' | 'api';

export interface JsonSpec {
    kind: SourceKind;
    /** Where the array is, inside one source. */
    path: JsonPath;
    /** Dotted path, inside an item, of the value that identifies the item in its DOM row. */
    anchor: string;
    /** Dotted path, inside an item, of this field's value. */
    key: string;
    anchorIsUrl: boolean;
    /** The anchor is an ID: matched against the row's ID attributes and the ID-like parts of its links. */
    anchorKind?: 'id';
}

export interface StructuredSource {
    kind: SourceKind;
    label: string;
    path: JsonPath;
    anchor: string;
    anchorIsUrl: boolean;
    anchorKind?: 'id';
    fields: { key: string; name: string; type: string }[];
    matched: number;
    sampled: number;
}

// Arrays are searched by a budget of nodes, not a depth: an app's bootstrap holds its data 14 levels down (Instagram).
const MAX_DEPTH = 64;
const MAX_NODES = 60_000;
const MAX_FIELD_DEPTH = 4;
const SKIP_KEYS = new Set(['@context', '@type', '@id', 'position', '__typename']);

// ------------------------------------------------------------------------------------- sources

interface Source { kind: SourceKind; label: string; data: unknown }

function parse(text: string): unknown {
    try { return JSON.parse(text.trim()); } catch { return undefined; }
}

let cache: { doc: Document; scripts: Element[]; sources: Source[]; scope: number } | null = null;

const STATE_ASSIGN = /(?:window\.)?(__[A-Z0-9_]+__|__remixContext|__APOLLO_STATE__)\s*=\s*/g;

/**
 * The JSON value that starts at `start` in script text (`window.__STATE__ = {…};`): scans to the
 * matching bracket, skipping strings, then parses. Undefined when it isn't plain JSON.
 */
export function jsonValueAt(text: string, start: number): unknown {
    const open = text[start];
    if (open !== '{' && open !== '[') return undefined;
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') i++;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
            depth--;
            if (depth === 0) return parse(text.slice(start, i + 1));
        }
    }
    return undefined;
}

/** The page's JSON sources (JSON-LD, JSON scripts, inline state), parsed once per change of its scripts. */
/**
 * Every structured source on the page, parsed once per set of inline scripts: the cache is keyed by
 * the script elements themselves (cheap to list), not their text (megabytes on large pages, and
 * read for every row and field).
 */
export function pageSources(doc: Document = document): Source[] {
    // Inside one scan the DOM doesn't change: the scripts are listed once, not per row and field.
    const scope = atomScope();
    if (cache && scope !== 0 && cache.scope === scope && cache.doc === doc) return [...cache.sources, ...netSources];
    const scripts = Array.from(doc.querySelectorAll('script:not([src])'));
    if (cache && cache.doc === doc && cache.scripts.length === scripts.length && cache.scripts.every((el, i) => el === scripts[i])) {
        cache.scope = scope;
        return [...cache.sources, ...netSources];
    }
    const sources: Source[] = [];
    for (const s of scripts) {
        const text = s.textContent || '';
        const type = (s.getAttribute('type') || '').toLowerCase();
        if (type === 'application/ld+json') {
            const data = parse(text);
            if (data !== undefined) sources.push({ kind: 'ld', label: 'JSON-LD', data });
        } else if (type === 'application/json' || s.id === '__NEXT_DATA__') {
            if (text.length < 200) continue; // config flags, not data
            const data = parse(text);
            if (data !== undefined) sources.push({ kind: 'json', label: s.id || 'JSON script', data });
        } else if ((!type || type === 'text/javascript' || type === 'module') && text.length >= 200) {
            STATE_ASSIGN.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = STATE_ASSIGN.exec(text))) {
                const data = jsonValueAt(text, m.index + m[0].length);
                if (data !== undefined) sources.push({ kind: 'state', label: m[1], data });
            }
        }
    }
    cache = { doc, scripts, sources, scope };
    return [...sources, ...netSources];
}

// API responses recorded by the API Finder hook (when it is on). Newest first, so a run reads the
// response of the page it is on.
let netSources: Source[] = [];
let netRefreshedAt = 0;
const MAX_NET_SOURCES = 40;

/** `timeoutMs`: how long to wait for the hook, which only answers when the API Finder recording is on. */
/** Parsed recorded responses by hook sequence number. */
let netParsed = new Map<number, Source | null>();

export async function refreshNetSources(timeoutMs = 1500): Promise<void> {
    netRefreshedAt = Date.now();
    const { installed, entries } = await requestNetEntries(timeoutMs);
    if (!installed) return;
    const fresh: Source[] = [];
    const parsed = new Map<number, Source | null>();
    for (const e of [...entries].sort((a, b) => b.seq - a.seq)) {
        // A response already parsed by an earlier refresh is reused, not parsed again.
        let src = netParsed.get(e.seq);
        if (src === undefined) {
            const text = (e.responseText || '').trim();
            const data = text && (text[0] === '{' || text[0] === '[') ? parse(text) : undefined;
            let label = e.url;
            try { label = new URL(e.url).pathname; } catch { /* keep the raw url */ }
            src = data === undefined ? null : { kind: 'api', label: `API ${label}`, data };
        }
        parsed.set(e.seq, src);
        if (src) fresh.push(src);
        if (fresh.length >= MAX_NET_SOURCES) break;
    }
    netParsed = parsed;
    netSources = fresh;
}

/**
 * Refreshes recorded API responses before reading rows, when a field reads JSON (at most every 800 ms):
 * rows a scroll loaded are often only in the API response that brought them, whatever source the
 * field was found in. Answers at once when no hook is recording.
 */
export async function refreshNetSourcesFor(columns: { reader?: { json?: JsonSpec; alternates?: { json?: JsonSpec }[] } }[] | null | undefined): Promise<void> {
    const usesJson = (columns ?? []).some(c => c.reader?.json || c.reader?.alternates?.some(a => a.json));
    if (usesJson && Date.now() - netRefreshedAt > 800) await refreshNetSources();
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

type ObjectArray = { path: JsonPath; items: Record<string, unknown>[] };

/** Arrays of objects (≥ 2 items) anywhere in a source, with their paths (within `MAX_NODES`). */
function objectArrays(data: unknown, path: JsonPath = [], out: ObjectArray[] = [], budget = { left: MAX_NODES }): ObjectArray[] {
    if (--budget.left < 0 || path.length > MAX_DEPTH || data === null || typeof data !== 'object') return out;
    if (Array.isArray(data)) {
        const objs = data.filter(d => d && typeof d === 'object' && !Array.isArray(d));
        if (objs.length >= 2 && objs.length >= data.length * 0.8) out.push({ path, items: objs as Record<string, unknown>[] });
        data.forEach((d, i) => objectArrays(d, [...path, i], out, budget));
        return out;
    }
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) objectArrays(v, [...path, k], out, budget);
    return out;
}

/** `objectArrays` of a source, once per parsed source. */
const arraysCache = new WeakMap<object, ObjectArray[]>();
function arraysOf(data: unknown): ObjectArray[] {
    if (!data || typeof data !== 'object') return [];
    let hit = arraysCache.get(data);
    if (!hit) { hit = objectArrays(data); arraysCache.set(data, hit); }
    return hit;
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

interface RowProbe { urls: Set<string>; ids: Set<string>; text: string }

/** `data-*` attributes that hold an item's ID: `data-sku`, `data-item-id`, `data-product-id`, `data-asin`. */
const ID_ATTR = /^data-(?:[a-z]+-){0,2}(?:id|sku|asin|pid|upc|gtin|item-?id|product-?id|sku-?id)$/i;
/**
 * A path segment or query value that looks like an ID: letters and digits with a digit, or a long
 * mixed-case token (a short code: `DesR-VXRAQU`).
 */
const ID_TOKEN = /^(?:(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{4,24}|(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{8,24})$/;

/** Probes by row within one scan (`withAtomCache`): a row's JSON fields are read one after another. */
const probes = new WeakMap<Element, { scope: number; probe: RowProbe }>();

function probe(row: Element): RowProbe {
    const scope = atomScope();
    const hit = probes.get(row);
    if (scope && hit?.scope === scope) return hit.probe;
    const p = scanProbe(row);
    if (scope) probes.set(row, { scope, probe: p });
    return p;
}

function scanProbe(row: Element): RowProbe {
    const urls = new Set<string>();
    const ids = new Set<string>();
    const links = row.tagName === 'A' ? [row] : Array.from(row.querySelectorAll('a[href]'));
    links.forEach(a => {
        // The link as read (a click tracker's destination, not the tracker).
        const href = readValue(a, 'href');
        const k = urlKey(href);
        if (k) urls.add(k);
        try {
            const u = new URL(href);
            u.pathname.split('/').forEach(seg => { if (ID_TOKEN.test(seg)) ids.add(seg); });
            u.searchParams.forEach(v => { if (ID_TOKEN.test(v)) ids.add(v); });
        } catch { /* not a URL */ }
    });
    for (const el of [row, ...Array.from(row.querySelectorAll('*'))].slice(0, 400)) {
        for (const at of Array.from(el.attributes)) {
            const v = at.value.trim();
            // An ID has a digit: `data-test-id="gpt-main"` names a part, not an item.
            if (ID_ATTR.test(at.name) && v.length >= 3 && v.length <= 40 && /\d/.test(v)) ids.add(v);
        }
    }
    return { urls, ids, text: norm(row.textContent || '') };
}

type AnchorKind = 'url' | 'id' | 'text';

function anchorMatches(p: RowProbe, value: string, kind: AnchorKind): boolean {
    return kind === 'url' ? p.urls.has(urlKey(value)) : kind === 'id' ? p.ids.has(value) : p.text.includes(norm(value));
}

const kindOf = (spec: { anchorIsUrl: boolean; anchorKind?: 'id' }): AnchorKind => (spec.anchorKind === 'id' ? 'id' : spec.anchorIsUrl ? 'url' : 'text');

/** Index of an array's items by anchor value, for matching rows at read time. */
const indexCache = new WeakMap<object, Map<string, Map<string, Record<string, unknown>>>>();

function itemIndex(items: Record<string, unknown>[], anchor: string, kind: AnchorKind): Map<string, Record<string, unknown>> {
    let byAnchor = indexCache.get(items);
    if (!byAnchor) { byAnchor = new Map(); indexCache.set(items, byAnchor); }
    let idx = byAnchor.get(`${kind}:${anchor}`);
    if (!idx) {
        idx = new Map();
        for (const item of items) {
            const raw = getDotted(item, anchor);
            const v = typeof raw === 'number' ? String(raw) : raw;
            const key = typeof v === 'string' && v ? (kind === 'url' ? urlKey(v) : kind === 'id' ? v.trim() : norm(v)) : '';
            if (key && !idx.has(key)) idx.set(key, item);
        }
        byAnchor.set(`${kind}:${anchor}`, idx);
    }
    return idx;
}

/** Every array at `path` in sources of `kind` (API responses: one per page fetched). */
function findArrays(kind: SourceKind, path: JsonPath): Record<string, unknown>[][] {
    const out: Record<string, unknown>[][] = [];
    for (const s of pageSources()) {
        if (s.kind !== kind) continue;
        const v = at(s.data, path);
        if (Array.isArray(v)) out.push(v as Record<string, unknown>[]);
    }
    return out;
}

/** The JSON item behind a DOM row, if any. */
function itemFor(row: Element, spec: Pick<JsonSpec, 'kind' | 'path' | 'anchor' | 'anchorIsUrl' | 'anchorKind'>): Record<string, unknown> | undefined {
    const p = probe(row);
    const kind = kindOf(spec);
    const byKey = (idx: Map<string, Record<string, unknown>>) => {
        for (const u of kind === 'url' ? p.urls : p.ids) { const hit = idx.get(u); if (hit) return hit; }
        return undefined;
    };
    for (const items of findArrays(spec.kind, spec.path)) {
        const idx = itemIndex(items, spec.anchor, kind);
        if (kind === 'url' || kind === 'id') {
            const hit = byKey(idx);
            if (hit) return hit;
            continue;
        }
        let best: Record<string, unknown> | undefined;
        let bestLen = 0;
        idx.forEach((item, key) => { if (key.length > bestLen && p.text.includes(key)) { best = item; bestLen = key.length; } });
        if (best) return best;
    }
    // Not where the field was found: the same items in another place, by their ID or URL (the API
    // page a scroll fetched names its array differently from the page's bootstrap).
    if (kind === 'text') return undefined;
    for (const s of pageSources()) {
        for (const { items } of arraysOf(s.data)) {
            if (getDotted(items[0], spec.anchor) === undefined) continue;
            const hit = byKey(itemIndex(items, spec.anchor, kind));
            if (hit) return hit;
        }
    }
    return undefined;
}

/** A key that holds a time (`taken_at`, `createdAt`, `timestamp`) and a number that is one in seconds or ms since 1970. */
const TIME_KEY = /(^|[._])([a-z]+_at|[a-z]+At|timestamp|date|time)$/;
function epochDate(key: string, v: unknown): string | undefined {
    if (typeof v !== 'number' || !TIME_KEY.test(key)) return undefined;
    const ms = v > 1e9 && v < 1e10 ? v * 1000 : v > 1e12 && v < 1e13 ? v : 0;
    return ms ? new Date(ms).toISOString() : undefined;
}

export function readJsonField(row: Element, spec: JsonSpec): string | undefined {
    const item = itemFor(row, spec);
    if (!item) return undefined;
    const v = getDotted(item, spec.key);
    if (v === null || v === undefined || v === '') return undefined;
    const date = epochDate(spec.key, v);
    if (date) return date;
    if (Array.isArray(v)) return v.every(x => typeof x === 'string' && looksUrl(x)) ? JSON.stringify(v) : v.join('; ');
    return String(v);
}

// ------------------------------------------------------------------------------------- finding

/**
 * What a JSON key holds, by its words (the last two segments): the meanings DOM fields have
 * (`fields/meaning.ts`), so a JSON field can back up the DOM field that means the same.
 */
export function jsonMeaning(key: string): string | undefined {
    const words = key.split('.').filter(p => !/^\d+$/.test(p)).slice(-2).join(' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
    if (/\b(was|list|regular|original|strike|msrp|compare at)\b.*\bprice\b/.test(words)) return 'Was Price';
    if (/\b(review count|number of reviews|num reviews|reviews count|rating count|total reviews)\b/.test(words)) return 'Review Count';
    if (/\b(average rating|rating value|customer rating|star rating)\b|^rating$/.test(words)) return 'Rating';
    if (/\b(price|current price|sale price|amount)$/.test(words) && !/\b(unit|per|range|display|savings)\b/.test(words)) return 'Price';
    if (/\bbrand( name)?$/.test(words)) return 'Brand';
    return undefined;
}

/** Wrappers of an item in an API's shape (`edges[].node`, `items[].item`): no part of a field's name. */
const WRAPPER = new Set(['item', 'node']);
/** A last key that says nothing alone (`caption.text`): named with its parent ("Caption Text"). */
const GENERIC = new Set(['text', 'value', 'uri', 'url', 'src', 'name']);

function fieldName(key: string): string {
    const parts = key.split('.').filter(p => !/^\d+$/.test(p) && !WRAPPER.has(p));
    const last = parts.length > 1 && GENERIC.has(parts[parts.length - 1]) ? `${parts[parts.length - 2]}_${parts[parts.length - 1]}` : parts[parts.length - 1] || key;
    const words = last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    return words.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function fieldType(key: string, values: unknown[]): string {
    const first = values.find(v => v !== undefined);
    if (Array.isArray(first)) return first.every(x => typeof x === 'string' && looksUrl(x)) ? 'image_array' : 'text';
    if (values.some(v => epochDate(key, v))) return 'date';
    const strings = values.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String).slice(0, 10);
    if (strings.length && strings.every(looksUrl)) return /image|photo|thumb|picture|logo|display_?ur[il]|cover|poster/i.test(key) ? 'image' : 'url';
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
    let bestRank = -1;

    for (const source of pageSources()) {
        for (const { path, items } of objectArrays(source.data)) {
            if (items.length < rows.length * 0.5) continue;
            const itemLeaves = items.map(i => leaves(i));
            const keys = new Map<string, unknown[]>();
            itemLeaves.forEach(l => l.forEach((v, k) => { const vs = keys.get(k) ?? []; vs.push(v); keys.set(k, vs); }));

            for (const [anchor, values] of keys) {
                // IDs may be numbers; an anchor is a value of ≥ 3 characters, unique across the items.
                const strings = values.map(v => (typeof v === 'number' && Number.isInteger(v) ? String(v) : v))
                    .filter((v): v is string => typeof v === 'string' && v.trim().length >= 3);
                // Nearly unique: a results array may repeat an item (a sponsored copy); the first is used.
                if (strings.length < items.length * 0.8 || new Set(strings).size < strings.length * 0.9) continue;
                const kinds: AnchorKind[] = strings.every(looksUrl) ? ['url'] : strings.every(v => v.trim().length >= 4) ? ['id', 'text'] : ['id'];
                for (const kind of kinds) {
                    const used = new Set<string>();
                    let matched = 0;
                    for (const p of probes) {
                        const hit = strings.find(v => !used.has(v) && anchorMatches(p, v, kind));
                        if (hit) { used.add(hit); matched++; }
                    }
                    if (matched < Math.max(2, rows.length * 0.6)) continue;
                    // More rows matched wins; on a tie an ID beats a URL beats a name.
                    const rank = { id: 2, url: 1, text: 0 }[kind];
                    if (best && (matched < best.matched || (matched === best.matched && rank <= bestRank))) continue;
                    bestRank = rank;

                    // Keys that say what they hold (price, rating, reviews, brand…) first: an item has hundreds.
                    const fields = [...keys.entries()]
                        .filter(([, vs]) => vs.length >= items.length * 0.3)
                        .sort(([a], [b]) => (jsonMeaning(a) ? 0 : 1) - (jsonMeaning(b) ? 0 : 1))
                        .slice(0, 40)
                        .map(([key, vs]) => ({ key, name: fieldName(key), type: fieldType(key, vs) }));
                    best = { kind: source.kind, label: source.label, path, anchor, anchorIsUrl: kind === 'url', ...(kind === 'id' ? { anchorKind: 'id' as const } : {}), fields, matched, sampled: rows.length };
                }
            }
        }
    }
    if (!best) return null;

    // Unique names: a repeated last segment takes its parent ("Offers Price").
    const seen = new Map<string, number>();
    best.fields.forEach(f => seen.set(f.name, (seen.get(f.name) ?? 0) + 1));
    best.fields.forEach(f => {
        if ((seen.get(f.name) ?? 0) > 1) {
            const parts = f.key.split('.').filter(p => !/^\d+$/.test(p) && !WRAPPER.has(p));
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
