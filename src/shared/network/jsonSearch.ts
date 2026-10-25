/**
 * Value-first JSON search: the user points at a value they can see on the page; we find where it sits
 * in a captured API response and generalise the path over every item of the list it belongs to
 * (`data.products[3].price` → `data.products[*].price`). Idea from thenos's json_index / network
 * value pickers.
 */
import type { JsonPath } from './types';

export interface ValueHit {
    path: JsonPath;
    value: unknown;
    /** How the value matched: exact text, same number, or the page text contains it / it contains the page text. */
    match: 'exact' | 'number' | 'contains';
}

const MAX_HITS = 50;
const MAX_NODES = 500_000;

function normaliseText(s: string): string {
    return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** "$1,299.00", "1.299,00 €", "1299" → 1299; undefined when the text holds no single number. */
export function parseNumberish(s: string): number | undefined {
    const m = s.replace(/\s/g, '').match(/-?[\d.,]+/g);
    if (!m || m.length !== 1) return undefined;
    let t = m[0];
    const lastComma = t.lastIndexOf(',');
    const lastDot = t.lastIndexOf('.');
    if (lastComma > lastDot) {
        // 1.299,00 or 1299,5 → decimal comma
        t = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else {
        t = t.replace(/,/g, '');
    }
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : undefined;
}

export function findValuePaths(root: unknown, needle: string): ValueHit[] {
    const target = normaliseText(needle);
    if (!target) return [];
    const targetNum = parseNumberish(needle);
    const hits: ValueHit[] = [];
    let visited = 0;

    const walk = (node: unknown, path: JsonPath) => {
        if (hits.length >= MAX_HITS || ++visited > MAX_NODES) return;
        if (node === null || node === undefined) return;
        if (Array.isArray(node)) {
            node.forEach((child, i) => walk(child, [...path, i]));
            return;
        }
        if (typeof node === 'object') {
            for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, [...path, k]);
            return;
        }
        if (typeof node === 'number') {
            if (targetNum !== undefined && Math.abs(node - targetNum) < 1e-9) hits.push({ path, value: node, match: 'number' });
            else if (targetNum !== undefined && Number.isInteger(node) && Math.abs(node / 100 - targetNum) < 1e-9) hits.push({ path, value: node, match: 'number' }); // price in cents
            return;
        }
        if (typeof node === 'string') {
            const v = normaliseText(node);
            if (!v) return;
            if (v === target) hits.push({ path, value: node, match: 'exact' });
            else if (target.length >= 4 && (v.includes(target) || (v.length >= 4 && target.includes(v) && v.length >= target.length * 0.5))) {
                hits.push({ path, value: node, match: 'contains' });
            } else if (targetNum !== undefined && parseNumberish(node) === targetNum && /\d/.test(v)) {
                hits.push({ path, value: node, match: 'number' });
            }
        }
    };
    walk(root, []);
    const rank = { exact: 0, number: 1, contains: 2 };
    return hits.sort((a, b) => rank[a.match] - rank[b.match] || a.path.length - b.path.length);
}

/** `["data","items",3,"price"]` → `data.items[3].price`; `"*"` renders as `[*]`. */
export function formatPath(path: JsonPath): string {
    let out = '';
    for (const seg of path) {
        if (typeof seg === 'number' || seg === '*') out += `[${seg}]`;
        else if (/^[A-Za-z_$][\w$]*$/.test(seg)) out += out ? `.${seg}` : seg;
        else out += `[${JSON.stringify(seg)}]`;
    }
    return out || '(root)';
}

/** Replaces the last array index with `*` (the list the value belongs to). */
export function generalisePath(path: JsonPath): JsonPath | null {
    for (let i = path.length - 1; i >= 0; i--) {
        if (typeof path[i] === 'number') return [...path.slice(0, i), '*', ...path.slice(i + 1)];
    }
    return null;
}

/** Values at a path that may contain `*`. */
export function resolvePath(root: unknown, path: JsonPath): unknown[] {
    let current: unknown[] = [root];
    for (const seg of path) {
        const next: unknown[] = [];
        for (const node of current) {
            if (node === null || typeof node !== 'object') continue;
            if (seg === '*') {
                if (Array.isArray(node)) next.push(...node);
            } else {
                const v = (node as any)[seg as any];
                if (v !== undefined) next.push(v);
            }
        }
        current = next;
    }
    return current;
}

/** The array a generalised path iterates (`data.items[*].price` → path of `data.items`). */
export function arrayPathOf(generalised: JsonPath): JsonPath | null {
    const i = generalised.indexOf('*');
    return i < 0 ? null : generalised.slice(0, i);
}
