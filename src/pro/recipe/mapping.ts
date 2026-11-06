/**
 * The transform as a mapping (`docs/plans/pro-transform-builder-plan.md` A–C): rows of "output ← from · how", which
 * ops fill in (or confirm from a proposal) instead of writing JOLT. The rows compile to the JOLT chain the crawler runs
 * (shift, modify-overwrite-beta, cardinality, default), so a recipe's file still carries plain JOLT, and Atlas can run it.
 *
 * - From: a field as it is; a key of an object field (`SPECS › Fuel type`); a column of a table field, over every
 *   row (`IMAGES › url`); or fixed text.
 * - How: as is; as a number, integer, text or boolean; upper, lower or trimmed; joined or split on a separator;
 *   counted; its first or last item; as a list, or as one value. A default fills it when the page has nothing.
 * - Proposals: each field of the target schema (the recipe's contract) is paired with the best source by its name and
 *   aliases and by whether the tested page's value fits its type, each source used once.
 */
import { convertValue, type Contract, type ContractField, type ContractType } from '../../shared/contracts/contract';
import { joltTransform, type JoltOperation } from './jolt';

export type MappingFrom =
    | { kind: 'field'; field: string }
    | { kind: 'key'; field: string; key: string }
    | { kind: 'column'; field: string; column: string }
    | { kind: 'text'; text: string };

export type MappingHow =
    | 'as-is' | 'number' | 'integer' | 'text' | 'boolean' | 'upper' | 'lower' | 'trim'
    | 'join' | 'split' | 'count' | 'first' | 'last' | 'list' | 'one';

export interface MappingRow {
    /** Where the value goes in the output: a name, or a dotted path to nest it (`offer.price`). */
    output: string;
    from: MappingFrom;
    how?: MappingHow;
    /** The separator to join or split on. */
    sep?: string;
    /** The value written when the page gives none. */
    default?: string | number | boolean;
}

export const HOW_LABEL: Record<MappingHow, string> = {
    'as-is': 'as it is', number: 'as a number', integer: 'as a whole number', text: 'as text', boolean: 'as true/false',
    upper: 'in upper case', lower: 'in lower case', trim: 'trimmed', join: 'joined', split: 'split', count: 'counted',
    first: 'first item', last: 'last item', list: 'as a list', one: 'as one value',
};

/** The modify function each "how" calls (join and split take the separator; list and one are cardinality). */
const MODIFY: Partial<Record<MappingHow, string>> = {
    number: '=toDouble', integer: '=toInteger', text: '=toString', boolean: '=toBoolean',
    upper: '=toUpper', lower: '=toLower', trim: '=trim', count: '=size', first: '=firstElement', last: '=lastElement',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------------------------------------------ sources

export interface MappingSource {
    from: MappingFrom;
    label: string;
    /** Its value on the tested page (a column's: every row's). */
    value?: unknown;
}

export const fromLabel = (f: MappingFrom): string =>
    f.kind === 'field' ? f.field : f.kind === 'key' ? `${f.field} › ${f.key}` : f.kind === 'column' ? `${f.field} › ${f.column} (each row)` : `"${f.text}"`;

/** A source's identity, to compare and to key it by. */
export const fromKey = (f: MappingFrom): string => JSON.stringify(f.kind === 'text' ? [f.kind, f.text] : f.kind === 'field' ? [f.kind, f.field] : [f.kind, f.field, f.kind === 'key' ? f.key : f.column]);

/** A source's value in a record (fields by name). */
export function valueOf(f: MappingFrom, record: Record<string, unknown> = {}): unknown {
    if (f.kind === 'text') return f.text;
    const v = record[f.field];
    if (f.kind === 'field') return v;
    if (f.kind === 'key') return isObj(v) ? v[f.key] : undefined;
    return Array.isArray(v) ? v.map(r => isObj(r) ? r[f.column] : undefined) : undefined;
}

/**
 * What a row can read: each field, each key of a field whose tested value is an object, and each column of a field
 * whose tested value is a list of objects (rows).
 */
export function mappingSources(fields: string[], sample: Record<string, unknown> = {}): MappingSource[] {
    const out: MappingSource[] = [];
    const add = (from: MappingFrom) => out.push({ from, label: fromLabel(from), value: valueOf(from, sample) });
    for (const field of fields) {
        add({ kind: 'field', field });
        const v = sample[field];
        if (isObj(v)) for (const key of Object.keys(v)) add({ kind: 'key', field, key });
        if (Array.isArray(v) && v.some(isObj)) {
            const columns = [...new Set(v.filter(isObj).flatMap(r => Object.keys(r)))];
            for (const column of columns) add({ kind: 'column', field, column });
        }
    }
    return out;
}

// ----------------------------------------------------------------------------------------------- problems

/** Characters that mean something in a JOLT spec key or output path: names with them can't be mapped yet. */
const SPECIAL_KEY = /[*|]|^[@$#&]/;
const OUTPUT_PART = /^[A-Za-z0-9_ -]+$/;

/** Why the rows can't be compiled, one line each (none: they can). */
export function mappingProblems(rows: MappingRow[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    rows.forEach((r, i) => {
        const at = `Row ${i + 1}`;
        if (!r.output.trim()) out.push(`${at}: give it an output name.`);
        else if (!r.output.split('.').every(p => OUTPUT_PART.test(p))) out.push(`${at}: "${r.output}" can only use letters, digits, _, - and spaces, with dots to nest.`);
        else if (seen.has(r.output)) out.push(`${at}: "${r.output}" is written by another row too.`);
        seen.add(r.output);
        const f = r.from;
        if (f.kind !== 'text' && !f.field) out.push(`${at}: pick what it reads.`);
        if (f.kind === 'key' && SPECIAL_KEY.test(f.key)) out.push(`${at}: the key "${f.key}" has a character JOLT reads as a pattern; write this one in JOLT.`);
        if (f.kind === 'column' && SPECIAL_KEY.test(f.column)) out.push(`${at}: the column "${f.column}" has a character JOLT reads as a pattern; write this one in JOLT.`);
        if (f.kind !== 'text' && SPECIAL_KEY.test(f.field)) out.push(`${at}: the field "${f.field}" has a character JOLT reads as a pattern.`);
        if ((r.how === 'join' || r.how === 'split') && (!r.sep || r.sep.includes("'"))) out.push(`${at}: give a separator to ${r.how} on (no quotes).`);
    });
    return out;
}

// ----------------------------------------------------------------------------------------------- compiler

type Spec = { [k: string]: Spec | string | string[] };

/** Writes `out` as what the spec node at `keys` sends its value to, next to what is there. */
function put(node: Spec, keys: string[], out: string) {
    const [k, ...rest] = keys;
    const at = node[k];
    if (!rest.length) {
        if (at === undefined) node[k] = out;
        else if (typeof at === 'string') node[k] = [at, out];
        else if (Array.isArray(at)) at.push(out);
        else put(at, ['@'], out);
        return;
    }
    if (at === undefined) node[k] = {};
    else if (typeof at === 'string' || Array.isArray(at)) node[k] = { '@': at };
    put(node[k] as Spec, rest, out);
}

/** A nested spec from dotted output paths: `{ offer: { price?: '=toDouble' } }`. */
function nest(target: Record<string, unknown>, path: string, value: unknown, optional: boolean) {
    const parts = path.split('.');
    let node = target;
    parts.forEach((p, i) => {
        const key = optional ? `${p}?` : p;
        if (i === parts.length - 1) node[key] = value;
        else node = (node[key] ??= {}) as Record<string, unknown>;
    });
}

/** The rows as a JOLT chain: a shift that reads and places, then the conversions, list or one, and defaults. */
export function compileMapping(rows: MappingRow[]): JoltOperation[] {
    const shift: Spec = {};
    const modify: Record<string, unknown> = {};
    const cardinality: Record<string, unknown> = {};
    const defaults: Record<string, unknown> = {};
    for (const r of rows) {
        const f = r.from;
        const out = r.output;
        if (f.kind === 'text') put(shift, [`#${f.text}`], out);
        else if (f.kind === 'field') put(shift, [f.field], out);
        else if (f.kind === 'key') put(shift, [f.field, f.key], out);
        else put(shift, [f.field, '*', f.column], `${out}[]`);
        const how = r.how ?? 'as-is';
        const leaf = out.split('.').pop()!;
        const fn = how === 'join' ? `=join('${r.sep}',@(1,${leaf}))`
            : how === 'split' ? `=split('${escapeRe(r.sep ?? '')}',@(1,${leaf}))`
            : MODIFY[how];
        if (fn) nest(modify, out, fn, true);
        if (how === 'list' || how === 'one') nest(cardinality, out, how === 'list' ? 'MANY' : 'ONE', false);
        if (r.default !== undefined && r.default !== '') nest(defaults, out, r.default, false);
    }
    const chain: JoltOperation[] = [{ operation: 'shift', spec: shift }];
    if (Object.keys(modify).length) chain.push({ operation: 'modify-overwrite-beta', spec: modify });
    if (Object.keys(cardinality).length) chain.push({ operation: 'cardinality', spec: cardinality });
    if (Object.keys(defaults).length) chain.push({ operation: 'default', spec: defaults });
    return chain;
}

/** The output on a record, or why the chain failed on it. */
export function mappingOutput(rows: MappingRow[], record: Record<string, unknown>): { value?: Record<string, unknown>; error?: string } {
    try {
        const v = joltTransform(structuredClone(record), compileMapping(rows));
        return { value: isObj(v) ? v : {} };
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}

/** The value at a dotted path of an output. */
export function valueAt(record: unknown, path: string): unknown {
    let v = record;
    for (const p of path.split('.')) v = isObj(v) ? v[p] : undefined;
    return v;
}

/** Whether a JOLT chain is still what the rows compile to (else it was edited by hand). */
export const compilesTo = (rows: MappingRow[], jolt: JoltOperation[]) => JSON.stringify(compileMapping(rows)) === JSON.stringify(jolt);

// ---------------------------------------------------------------------------------------------- proposals

const tokens = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** How well a source's name reads as the field: its name or an alias exactly (3), as part of it (2), every word (1.5). */
function nameScore(field: ContractField, name: string): number {
    const c = tokens(name);
    const names = [field.name, ...(field.aliases ?? [])].map(tokens).filter(Boolean);
    if (names.includes(c)) return 3;
    if (names.some(n => n.length >= 3 && ` ${c} `.includes(` ${n} `))) return 2;
    const words = c.split(' ');
    if (names.some(n => n.split(' ').every(w => words.includes(w)))) return 1.5;
    return 0;
}

const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.every(x => x === undefined || x === null || x === ''));
const numeric = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

const wantsUrl = (f: ContractField) => f.type === 'url' || f.type === 'image' || /image|photo|picture|url|link/i.test(f.name);

/** How a value becomes the contract's type, when JOLT can do it on this value; else as it is. */
function howFor(type: ContractType, value: unknown): MappingHow | undefined {
    const many = Array.isArray(value);
    if (type === 'string[]') return many ? undefined : 'list';
    if (many) return 'first';
    if ((type === 'number' || type === 'rating') && typeof value === 'string' && numeric(value)) return 'number';
    if ((type === 'integer' || type === 'count') && typeof value === 'string' && numeric(value)) return 'integer';
    if (type === 'boolean' && typeof value === 'string' && /^(true|false)$/i.test(value.trim())) return 'boolean';
    return undefined;
}

/**
 * Rows that fill the contract from the recipe's fields: every (contract field, source) pair scored by name and
 * aliases, plus one when the tested value reads as the field's type (pairs whose value can't, and whose name is not
 * exact, are dropped); the best pairs taken first, each field and source once. Weak pairs (under 2) are left out.
 */
export function proposeMapping(contract: Contract, fields: string[], sample?: Record<string, unknown>): MappingRow[] {
    const sources = mappingSources(fields, sample);
    const pairs: { field: ContractField; source: MappingSource; score: number }[] = [];
    for (const field of contract.fields) {
        if (field.runtime) continue;
        for (const source of sources) {
            const f = source.from;
            if (f.kind === 'text') continue;
            const name = f.kind === 'field' ? f.field : f.kind === 'key' ? f.key : f.column;
            let score = Math.max(nameScore(field, name), f.kind === 'column' ? nameScore(field, `${f.field} ${f.column}`) - 0.5 : 0);
            // A table's column is a list: it suits a list field better than the field holding the table.
            if (f.kind === 'column' && field.type === 'string[]') score += 0.25;
            if (score === 0) continue;
            // A table (rows of objects) gives no contract value as it is: its columns do.
            const rows = Array.isArray(source.value) && source.value.some(isObj);
            if (rows) score -= 1.5;
            if (sample && filled(source.value) && !rows) {
                const v = source.value;
                const reads = convertValue(field, Array.isArray(v) && field.type !== 'string[]' ? v.find(filled) : v) !== undefined;
                if (reads) score += 1;
                else if (score < 3) continue;
                // Images and links: a value that is a URL beats one that is not (a table's url column over its id).
                if (wantsUrl(field) && [v].flat().some(x => typeof x === 'string' && /^https?:\/\//.test(x))) score += 0.5;
            }
            pairs.push({ field, source, score });
        }
    }
    pairs.sort((a, b) => b.score - a.score);
    const chosen = new Map<string, MappingRow>();
    const used = new Set<string>();
    for (const p of pairs) {
        const key = fromKey(p.source.from);
        if (p.score < 2 || chosen.has(p.field.name) || used.has(key)) continue;
        used.add(key);
        const how = howFor(p.field.type, p.source.value);
        chosen.set(p.field.name, {
            output: p.field.name, from: p.source.from,
            ...(how ? { how } : {}),
            ...(p.field.default !== undefined && ['string', 'number', 'boolean'].includes(typeof p.field.default) ? { default: p.field.default as string | number | boolean } : {}),
        });
    }
    return contract.fields.flatMap(f => chosen.get(f.name) ?? []);
}
