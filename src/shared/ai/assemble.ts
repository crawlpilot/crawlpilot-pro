/**
 * Flat answers back into the user's shape (docs/plans/ai-extract-v2-plan.md §3.1):
 *
 * - `assemble`: leaf values (by flat key) become JSON exactly in the schema's shape. An empty optional
 *   value is left out; an empty required one is `null`. A leaf holding several values is split into an
 *   array; an enum value is matched to the allowed spelling.
 * - `validate`: the result against the schema: type, enum, required, format, min/maxItems. Problems come
 *   back by JSON pointer.
 * - `sourcesByPointer`: per-leaf metadata (status, where it came from) keyed by the pointer of the value
 *   in the result, as thenos's `show_sources` but down to the value.
 */
import type { JsonSchema } from './schemaNormalize';
import type { Leaf, SchemaPlan } from './schemaPlan';

export type LeafValues = Record<string, unknown>;

export interface AssembleInput {
    single: LeafValues;
    /** Per list key, its items' leaf values. */
    lists: Record<string, LeafValues[]>;
}

export interface Problem {
    pointer: string;
    problem: string;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** Several values from one answer: `a | b`, one per line, or `a; b`. */
export function splitMany(v: unknown): unknown[] {
    if (Array.isArray(v)) return v.filter(x => !isEmpty(x));
    if (typeof v !== 'string') return isEmpty(v) ? [] : [v];
    const sep = v.includes(' | ') || v.includes('|') ? /\s*\|\s*/ : v.includes('\n') ? /\s*\n\s*/ : /\s*;\s*/;
    return v.split(sep).map(s => s.trim()).filter(Boolean);
}

function coerce(leaf: Leaf, v: unknown): unknown {
    if (isEmpty(v)) return undefined;
    if (leaf.enum && typeof v === 'string') {
        const hit = leaf.enum.find(e => String(e).toLowerCase() === v.trim().toLowerCase());
        if (hit !== undefined) return hit;
    }
    if ((leaf.type === 'number' || leaf.type === 'integer') && typeof v === 'string') {
        const n = Number(v.replace(/[^\d.-]/g, ''));
        if (v.trim() && Number.isFinite(n)) return leaf.type === 'integer' ? Math.round(n) : n;
    }
    if (leaf.type === 'boolean' && typeof v === 'string') {
        if (/^(true|yes|y|1)$/i.test(v.trim())) return true;
        if (/^(false|no|n|0)$/i.test(v.trim())) return false;
    }
    return v;
}

function valueOf(leaf: Leaf, raw: unknown): unknown {
    if (leaf.many) {
        const parts = splitMany(raw).map(p => coerce(leaf, p)).filter(p => p !== undefined);
        return parts.length ? parts : undefined;
    }
    return coerce(leaf, raw);
}

/** Leaf values into an object in the schema's shape. */
function build(leaves: Leaf[], values: LeafValues): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const leaf of leaves) {
        const v = valueOf(leaf, values[leaf.key]);
        if (v === undefined && !leaf.required) continue;
        if (!leaf.path.length) continue;
        let at = out;
        for (const part of leaf.path.slice(0, -1)) {
            if (!at[part] || typeof at[part] !== 'object') at[part] = {};
            at = at[part] as Record<string, unknown>;
        }
        at[leaf.path[leaf.path.length - 1]] = v ?? null;
    }
    return out;
}

/** An item of a list whose leaves have no path (a list of plain values) is the value itself. */
function buildItem(leaves: Leaf[], values: LeafValues): unknown {
    if (leaves.length === 1 && !leaves[0].path.length) return valueOf(leaves[0], values[leaves[0].key]) ?? null;
    return build(leaves, values);
}

export function assemble(plan: SchemaPlan, input: AssembleInput): unknown {
    const listValue = (key: string) => {
        const list = plan.lists.find(l => l.key === key)!;
        // Items stay in order, one per input item, so `/products/3` here is item 3 in `sourcesByPointer`.
        return (input.lists[key] ?? []).map(item => buildItem(list.leaves, item));
    };
    if (plan.rootList) return listValue(plan.lists[0].key);
    const out = build(plan.single, input.single);
    for (const list of plan.lists) out[list.pointer.slice(1)] = listValue(list.key);
    return out;
}

// ── Validation ──

const FORMAT_CHECKS: Record<string, (s: string) => boolean> = {
    uri: s => /^(https?:)?\/\/\S+$|^data:/i.test(s),
    email: s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
    date: s => !Number.isNaN(Date.parse(s)) || /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(s),
    'date-time': s => !Number.isNaN(Date.parse(s)),
};

function typeMatches(type: string, v: unknown): boolean {
    switch (type) {
        case 'string': return typeof v === 'string';
        case 'number': return typeof v === 'number' && Number.isFinite(v);
        case 'integer': return typeof v === 'number' && Number.isInteger(v);
        case 'boolean': return typeof v === 'boolean';
        case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
        case 'array': return Array.isArray(v);
        default: return true;
    }
}

/** Problems in `data` against the (normalised) `schema`, by JSON pointer. `null` is allowed but flagged when required. */
export function validate(data: unknown, schema: JsonSchema): Problem[] {
    const problems: Problem[] = [];
    const walk = (v: unknown, node: JsonSchema, at: string) => {
        if (v === null || v === undefined) return;
        if (!typeMatches(node.type, v)) { problems.push({ pointer: at, problem: `should be ${node.type === 'integer' ? 'a whole number' : `a ${node.type}`}` }); return; }
        if (node.type === 'object') {
            const obj = v as Record<string, unknown>;
            for (const r of node.required ?? []) if (obj[r] === null || obj[r] === undefined) problems.push({ pointer: `${at}/${r}`, problem: 'required, not found' });
            for (const [k, child] of Object.entries(node.properties ?? {})) if (k in obj) walk(obj[k], child as JsonSchema, `${at}/${k}`);
            return;
        }
        if (node.type === 'array') {
            const arr = v as unknown[];
            if (typeof node.minItems === 'number' && arr.length < node.minItems) problems.push({ pointer: at, problem: `needs at least ${node.minItems} items` });
            if (typeof node.maxItems === 'number' && arr.length > node.maxItems) problems.push({ pointer: at, problem: `at most ${node.maxItems} items` });
            arr.forEach((item, i) => walk(item, node.items ?? {}, `${at}/${i}`));
            return;
        }
        if (node.enum && !node.enum.includes(v as never)) problems.push({ pointer: at, problem: `not one of ${node.enum.join(', ')}` });
        if (typeof v === 'string' && node.format && FORMAT_CHECKS[node.format] && !FORMAT_CHECKS[node.format](v)) problems.push({ pointer: at, problem: `not a valid ${node.format === 'uri' ? 'URL' : node.format}` });
    };
    walk(data, schema, '');
    return problems;
}

// ── Sources ──

/** Per-leaf metadata keyed by the pointer of each value in the result (`/address/city`, `/products/3/price`). */
export function sourcesByPointer<M>(plan: SchemaPlan, single: Record<string, M | undefined>, lists: Record<string, (Record<string, M | undefined>)[]>): Record<string, M> {
    const out: Record<string, M> = {};
    for (const leaf of plan.single) { const m = single[leaf.key]; if (m !== undefined) out[leaf.pointer] = m; }
    for (const list of plan.lists) {
        (lists[list.key] ?? []).forEach((item, i) => {
            for (const leaf of list.leaves) { const m = item[leaf.key]; if (m !== undefined) out[`${list.pointer}/${i}${leaf.pointer}`] = m; }
        });
    }
    return out;
}
