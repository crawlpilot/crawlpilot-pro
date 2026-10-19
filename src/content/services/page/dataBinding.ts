/**
 * Page Extractor fields bound to the page's data (`docs/plans/page-extractor-background-plan.md` P3).
 * Content opened by a click (a specs tab, a details accordion) is usually in the page's JSON already
 * (`__NEXT_DATA__`, JSON-LD, inline state): Walmart's specs table is `idml.specifications`, a list of
 * `{ name, value }`. When the user picks a field, its value is looked for there; a run reads the
 * same place on every page, with no click, no window and no waiting for the section to render.
 *
 * The path must hold on other pages: no keys that are an item's own ID (`variantsMap.1J3CQMIQGEAH`),
 * and an array item is chosen by its label (`{ name: "Btu" }`), not its position, when it has one.
 */
import type { DataBinding, JsonStep } from '../../../shared/types/database';
import { pageSources } from '../extraction/structuredRows';
import { atomText, isTextAtom } from '../extraction/atoms';

const MAX_NODES = 200_000;
const MAX_DEPTH = 14;
/** Keys that are labels of an object in a list ("name": "Btu"), tried first to choose an item. */
const LABEL_KEYS = ['name', 'label', 'key', 'title', 'displayName', 'attribute', 'attributeName', 'type'];

const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const isPrimitive = (v: unknown) => typeof v === 'string' || typeof v === 'number';
/** A key that is one item's own ID, not a name the next page also has. */
const idLike = (k: string) => /\d{5,}/.test(k) || (k.length >= 8 && /\d/.test(k) && /^[A-Z0-9_-]+$/.test(k));

type Source = ReturnType<typeof pageSources>[number];

function sourcesOf(): { src: Source; nth: number }[] {
    const seen = new Map<string, number>();
    return pageSources().filter(s => s.kind !== 'api').map(src => {
        const key = `${src.kind}|${src.label}`;
        const nth = seen.get(key) ?? 0;
        seen.set(key, nth + 1);
        return { src, nth };
    });
}

/** Every node of a source with its raw path (keys and indexes), depth- and size-bounded. */
function* walk(data: unknown): Generator<{ value: unknown; path: (string | number)[] }> {
    let seen = 0;
    const stack: { value: unknown; path: (string | number)[] }[] = [{ value: data, path: [] }];
    while (stack.length > 0 && seen++ < MAX_NODES) {
        const node = stack.pop()!;
        yield node;
        if (node.path.length >= MAX_DEPTH || node.value === null || typeof node.value !== 'object') continue;
        if (Array.isArray(node.value)) node.value.forEach((v, i) => stack.push({ value: v, path: [...node.path, i] }));
        else Object.entries(node.value as Record<string, unknown>).forEach(([k, v]) => stack.push({ value: v, path: [...node.path, k] }));
    }
}

function at(data: unknown, path: (string | number)[]): unknown {
    let cur: any = data;
    for (const k of path) { if (cur == null) return undefined; cur = cur[k]; }
    return cur;
}

/**
 * A raw path made to hold on other pages: each array index becomes "the item whose label is …" when
 * the items have a label key telling them apart; an index stays an index otherwise. Null when a key
 * is an item's own ID.
 */
function stablePath(data: unknown, raw: (string | number)[]): JsonStep[] | null {
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

function follow(data: unknown, path: JsonStep[]): unknown {
    let cur: any = data;
    for (const step of path) {
        if (cur == null) return undefined;
        if (typeof step === 'object') cur = Array.isArray(cur) ? cur.find(o => o?.[step.where] === step.is) : undefined;
        else cur = cur[step];
    }
    return cur;
}

/** Fewer positions first (they may differ on another page), then shorter. */
const rank = (p: JsonStep[]) => p.filter(s => typeof s === 'number').length * 100 + p.length;

/** The number in a shown value and what is written around it: "$194.00" → 194, "$", "". */
function numberIn(text: string): { n: number; prefix: string; suffix: string } | null {
    const m = /^([^\d]{0,4}?)\s?(\d[\d,]*(?:\.\d+)?)\s?([^\d]{0,12})$/.exec(text.trim());
    return m ? { n: Number(m[2].replace(/,/g, '')), prefix: m[1], suffix: m[3] } : null;
}

function bindScalar(value: string): DataBinding | null {
    const want = norm(value);
    if (want.length === 0 || want.length > 300) return null;
    const num = numberIn(value);
    let best: { b: DataBinding; score: number } | null = null;
    for (const { src, nth } of sourcesOf()) {
        for (const { value: v, path } of walk(src.data)) {
            if (!isPrimitive(v)) continue;
            const exact = norm(v) === want;
            const asNumber = !exact && num && typeof v === 'number' && v === num.n;
            if (!exact && !asNumber) continue;
            const stable = stablePath(src.data, path);
            if (!stable) continue;
            // A written match beats a bare number; then the path most likely to hold elsewhere.
            const score = (exact ? 0 : 10_000) + rank(stable);
            if (best && best.score <= score) continue;
            best = { score, b: { kind: src.kind as DataBinding['kind'], label: src.label, nth, path: stable, as: 'text', ...(asNumber ? { prefix: num!.prefix, suffix: num!.suffix } : {}) } };
        }
    }
    return best?.b ?? null;
}

/** Rows (cells) or items: an array whose items are them, read by the keys that hold each column. */
function bindRows(rows: string[][], as: 'rows' | 'list'): DataBinding | null {
    const wanted = rows.filter(r => r.length > 0);
    if (wanted.length < 2) return null;
    let best: { b: DataBinding; score: number } | null = null;
    for (const { src, nth } of sourcesOf()) {
        for (const { value: v, path } of walk(src.data)) {
            if (!Array.isArray(v) || v.length < 2) continue;
            let keys: string[] | null = null;
            if (v.every(isPrimitive)) {
                if (wanted[0].length !== 1) continue;
                keys = [];
            } else if (v.every(o => o && typeof o === 'object' && !Array.isArray(o))) {
                // Column j's key: the one holding cell j in most rows.
                keys = wanted[0].map((_, j) => {
                    const counts = new Map<string, number>();
                    wanted.forEach(r => v.forEach(o => Object.entries(o).forEach(([k, x]) => { if (isPrimitive(x) && norm(x) === norm(r[j])) counts.set(k, (counts.get(k) ?? 0) + 1); })));
                    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
                });
                if (keys.some(k => !k)) continue;
            } else continue;
            const read = readItems(v, keys);
            const found = new Set(read.map(r => r.map(norm).join('\u0001')));
            const matched = wanted.filter(r => found.has(r.map(norm).join('\u0001'))).length;
            if (matched < wanted.length * 0.8) continue;
            const stable = stablePath(src.data, path);
            if (!stable) continue;
            const score = rank(stable) - matched * 1000;
            if (best && best.score <= score) continue;
            best = { score, b: { kind: src.kind as DataBinding['kind'], label: src.label, nth, path: stable, as, keys } };
        }
    }
    return best?.b ?? null;
}

function readItems(list: unknown[], keys: string[]): string[][] {
    return list.map(o => (keys.length === 0 ? [String(o)] : keys.map(k => String((o as any)?.[k] ?? ''))));
}

/** The picked element's value as the Page Extractor reads it, for finding it in the page's data. */
function shownValue(el: HTMLElement, type: string): string | string[][] | null {
    const text = (e: Element) => ((isTextAtom(e) ? atomText(e) : (e as HTMLElement).innerText) || e.textContent || '').replace(/\s+/g, ' ').trim();
    if (type === 'text') return text(el);
    if (type === 'text_array') return Array.from(el.children).map(c => [text(c)]).filter(r => r[0]);
    if (type === 'table') {
        const body = el.querySelector('tbody') ?? el;
        return Array.from(body.children).map(r => Array.from(r.children).map(text)).filter(r => r.some(Boolean));
    }
    return null;
}

/** Where the picked element's value is in the page's data, if it is there in a way other pages share. */
export function bindToData(el: HTMLElement, type: string): DataBinding | null {
    try {
        const v = shownValue(el, type);
        if (v === null) return null;
        if (typeof v === 'string') return bindScalar(v);
        return bindRows(v, type === 'table' ? 'rows' : 'list');
    } catch {
        return null;
    }
}

/** The bound value on this page: text, a list of strings, or rows of cells; undefined when it isn't there. */
export function readBinding(b: DataBinding): string | string[] | string[][] | undefined {
    const src = sourcesOf().find(s => s.src.kind === b.kind && s.src.label === b.label && s.nth === b.nth)?.src
        ?? sourcesOf().find(s => s.src.kind === b.kind && s.src.label === b.label)?.src;
    if (!src) return undefined;
    const v = follow(src.data, b.path);
    if (b.as === 'text') {
        if (!isPrimitive(v) || String(v).trim() === '') return undefined;
        return `${b.prefix ?? ''}${typeof v === 'number' && b.prefix && /[\p{Sc}]/u.test(b.prefix) ? v.toFixed(2) : v}${b.suffix ?? ''}`.trim();
    }
    if (!Array.isArray(v) || v.length === 0) return undefined;
    const rows = readItems(v, b.keys ?? []);
    return b.as === 'list' ? rows.map(r => r[0]).filter(Boolean) : rows;
}
