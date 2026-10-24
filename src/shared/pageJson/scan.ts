/**
 * What a page's JSON holds, as things a person can pick (after thenos `json_index`, design only):
 *
 * - **items**: one record each, a JSON-LD entity (addressed by its `@type`, so another JSON-LD block
 *   added before it changes nothing) or an object of app state with many values;
 * - **lists**: arrays of similar objects (search results, products, reviews), one row per object.
 *
 * Advertising and telemetry are never walked. Each candidate carries its attributes, so the side
 * panel needs no second trip, and the binding a run reads (`bindingsFor`).
 */
import type { DataBinding, JsonStep } from '../types/database';
import { attributesOf, type JsonAttribute } from './attributes';
import { isNoiseKey } from './noise';
import { formatSteps, stablePath } from './path';

export type JsonSourceKind = 'ld' | 'json' | 'state';

/** A parsed JSON source of the page; `nth` tells apart sources of one kind and label. */
export interface JsonSource {
    kind: JsonSourceKind;
    label: string;
    nth: number;
    data: unknown;
}

export interface JsonCandidate {
    id: string;
    kind: 'item' | 'list';
    source: { kind: JsonSourceKind; label: string; nth: number };
    /** JSON-LD: the entity's `@type`; `path` is then inside the entity. */
    type?: string;
    path: JsonStep[];
    /** "Product", "products". */
    title: string;
    /** Where it is, as people read it. */
    where: string;
    /** Rows: 1 for an item. */
    count: number;
    sample: string;
    attributes: JsonAttribute[];
    score: number;
}

const MAX_NODES = 60_000;
const MAX_DEPTH = 14;
const MAX_EACH = 6;
const MIN_ITEM_VALUES = 5;
const LIST_NAMES = /^(products?|items?|results?|listings?|hits|edges|nodes|records|entries|posts|articles|jobs|reviews|comments|offers|stores|locations|cards|tiles|docs|rows|data|search(results)?|itemlistelement)$/i;
const ITEM_NAMES = /(product|item|article|post|job|listing|detail|offer|event|recipe|place|business|profile|video)/i;
/** The app's own setup (feature flags, page layout, translations), not the page's data. */
const SETUP = /(config|flags?|features?|experiments?|bootstrap|settings|abtests?|i18n|translations|messages|layout|modules?|metadata|schedule|widgets?|zones?|slots?|_all_)/i;

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const typeOf = (o: unknown): string | undefined => {
    if (!isPlain(o)) return undefined;
    const t = o['@type'];
    const first = Array.isArray(t) ? t[0] : t;
    return typeof first === 'string' ? first : undefined;
};

/** A JSON-LD block's top entities: the block, its array items, its `@graph` items. */
export function topEntities(data: unknown): { entity: Record<string, unknown>; raw: (string | number)[] }[] {
    const out: { entity: Record<string, unknown>; raw: (string | number)[] }[] = [];
    const add = (v: unknown, raw: (string | number)[]) => {
        if (!isPlain(v)) return;
        if (Array.isArray(v['@graph'])) { (v['@graph'] as unknown[]).forEach((g, i) => add(g, [...raw, '@graph', i])); if (!typeOf(v)) return; }
        out.push({ entity: v, raw });
    };
    if (Array.isArray(data)) data.forEach((d, i) => add(d, [i]));
    else add(data, []);
    return out;
}

/** The entity of this `@type` among the page's JSON-LD blocks (the first one). */
export function entityByType(sources: { kind: string; data: unknown }[], type: string): Record<string, unknown> | undefined {
    for (const s of sources) {
        if (s.kind !== 'ld') continue;
        const hit = topEntities(s.data).find(e => typeOf(e.entity) === type);
        if (hit) return hit.entity;
    }
    return undefined;
}

interface Root { source: JsonSource; type?: string; data: unknown; raw: (string | number)[] }

/** Where to walk: each JSON-LD entity (the first of its type keeps the type), each other source whole. */
function rootsOf(sources: JsonSource[]): Root[] {
    const roots: Root[] = [];
    const typed = new Set<string>();
    for (const source of sources) {
        if (source.kind !== 'ld') { roots.push({ source, data: source.data, raw: [] }); continue; }
        for (const { entity, raw } of topEntities(source.data)) {
            const t = typeOf(entity);
            const type = t && !typed.has(t) ? t : undefined;
            if (type) typed.add(type);
            roots.push(type ? { source, type, data: entity, raw: [] } : { source, data: source.data, raw });
        }
    }
    return roots;
}

/** Keys most of the first items share. */
function commonKeys(items: Record<string, unknown>[]): number {
    const sample = items.slice(0, 20);
    const counts = new Map<string, number>();
    sample.forEach(o => Object.keys(o).forEach(k => counts.set(k, (counts.get(k) ?? 0) + 1)));
    return [...counts.values()].filter(n => n >= sample.length * 0.5).length;
}

/** Values of its own that are data: text and numbers (a wall of booleans is feature flags). */
const valueCount = (o: Record<string, unknown>) => Object.values(o).filter(v => (typeof v === 'string' || typeof v === 'number') && v !== '').length;
const isSetup = (path: (string | number)[]) => path.some(p => typeof p === 'string' && SETUP.test(p));

/** Two values that say what it is: its name or title first. */
function sampleOf(attrs: JsonAttribute[]): string {
    const shown = attrs.filter(a => a.suggested && a.sample && !a.many);
    const named = (a: JsonAttribute) => (/(^|\.)(name|title|headline)$/i.test(a.key) ? 0 : 1);
    return [...shown].sort((a, b) => named(a) - named(b)).slice(0, 2).map(a => a.sample.slice(0, 40)).join(' · ');
}

/** The items and lists in the page's JSON, best first: at most six of each. */
export function scanPageJson(sources: JsonSource[]): JsonCandidate[] {
    const items: JsonCandidate[] = [];
    const lists: JsonCandidate[] = [];

    for (const root of rootsOf(sources)) {
        const { source } = root;
        const base = { source: { kind: source.kind, label: source.label, nth: source.nth }, ...(root.type ? { type: root.type } : {}) };
        const where = (path: JsonStep[]) => [root.type ?? source.label, formatSteps(path)].filter(Boolean).join(' › ');

        if (root.type) {
            const attributes = attributesOf([root.data]);
            if (attributes.length >= 2) {
                items.push({
                    ...base, id: `item:${source.kind}:${root.type}`, kind: 'item', path: [], title: root.type, where: where([]),
                    count: 1, sample: sampleOf(attributes), attributes, score: 100 + attributes.length * 3,
                });
            }
        }

        // Walk the root, depth- and size-bounded, skipping advertising and telemetry.
        let seen = 0;
        const stack: { value: unknown; path: (string | number)[] }[] = [{ value: root.data, path: [] }];
        while (stack.length && seen++ < MAX_NODES) {
            const { value, path } = stack.pop()!;
            if (value === null || typeof value !== 'object' || path.length > MAX_DEPTH) continue;
            const last = path[path.length - 1];
            const indexes = path.filter(p => typeof p === 'number').length;

            if (Array.isArray(value)) {
                const objs = value.filter(isPlain);
                if (path.length && objs.length >= 2 && objs.length >= value.length * 0.8) {
                    const shared = commonKeys(objs);
                    const steps = stablePath(root.data, path);
                    if (shared >= 2 && steps) {
                        const named = [...path].reverse().find(p => typeof p === 'string') as string | undefined;
                        const attributes = attributesOf(objs);
                        if (attributes.length >= 2) {
                            lists.push({
                                ...base, id: `list:${source.kind}:${source.label}:${source.nth}:${root.type ?? ''}:${JSON.stringify(steps)}`,
                                kind: 'list', path: steps, title: named ?? 'items', where: where(steps),
                                count: objs.length, sample: sampleOf(attributes), attributes,
                                score: Math.min(objs.length, 50) + Math.min(shared, 20) * 2 + (named && LIST_NAMES.test(named) ? 25 : 0)
                                    - indexes * 30 - path.length - (isSetup(path) ? 60 : 0),
                            });
                        }
                    }
                }
                value.forEach((v, i) => stack.push({ value: v, path: [...path, i] }));
                continue;
            }

            // An object of app state with many values of its own, at a path other pages share.
            if (!root.type && path.length && indexes === 0 && typeof last === 'string' && !isSetup(path) && valueCount(value as Record<string, unknown>) >= MIN_ITEM_VALUES) {
                const steps = stablePath(root.data, path);
                if (steps) {
                    const attributes = attributesOf([value]);
                    items.push({
                        ...base, id: `item:${source.kind}:${source.label}:${source.nth}:${JSON.stringify(steps)}`,
                        kind: 'item', path: steps, title: last, where: where(steps),
                        count: 1, sample: sampleOf(attributes), attributes,
                        score: valueCount(value as Record<string, unknown>) * 2 + (ITEM_NAMES.test(last) ? 30 : 0) - path.length * 3,
                    });
                }
            }
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                if (v && typeof v === 'object' && !isNoiseKey(k)) stack.push({ value: v, path: [...path, k] });
            }
        }
    }

    const best = (xs: JsonCandidate[]) => xs.sort((a, b) => b.score - a.score).slice(0, MAX_EACH);
    return [...best(items), ...best(lists)];
}

/** A ticked attribute, with the name the person gave it. */
export interface PickedAttribute { key: string; name: string; many?: boolean }

/** A Page Extractor element that reads from the page's data only (no selectors). */
export interface DataElement {
    id: string;
    name: string;
    action: 'extract';
    type: string;
    selectors: string[];
    data: DataBinding;
    value?: string;
}

/**
 * The elements a recipe reads for these picks: an item gives one element per attribute; a list gives
 * one list element whose rows are its items and whose columns are the picks.
 */
export function bindingsFor(c: JsonCandidate, picks: PickedAttribute[], idBase = Date.now()): DataElement[] {
    const at = { kind: c.source.kind, label: c.source.label, nth: c.source.nth, ...(c.type ? { type: c.type } : {}), path: c.path };
    if (c.kind === 'list') {
        return [{
            id: String(idBase), name: c.title, action: 'extract', type: 'list', selectors: [],
            data: { ...at, as: 'rows', keys: picks.map(p => p.key), names: picks.map(p => p.name) },
            value: `List (${c.count} items)`,
        }];
    }
    return picks.map((p, i) => ({
        id: `${idBase}_${i}`, name: p.name, action: 'extract', type: p.many ? 'text_array' : 'text', selectors: [],
        data: { ...at, as: p.many ? 'list' : 'text', key: p.key },
        value: c.attributes.find(a => a.key === p.key)?.sample,
    }));
}
