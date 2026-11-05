/**
 * JOLT, the JSON-to-JSON transformation Atlas uses to turn a page's record into the schema its consumers want
 * (`docs/plans/pro-page-data-jolt-plan.md`). A chain of operations, each with a spec, as JOLT writes them, so a spec
 * written for Atlas runs here unchanged:
 * - `shift`: the spec mirrors the input; each value read is written at the output path(s) it names.
 *   - Keys match literally, as `*` or `pre*suf` (with captures), or as `a|b`.
 *   - `@` is the current value, `@(n,path)` a value up the tree, `$`/`$n` the key matched as the value, `#text` a
 *     literal.
 *   - Output paths take `&`/`&n`/`&(n,m)`, `[]`, `[n]`, `[&n]`, `[#n]` and `@(n,path)`.
 *   - Two values written to one path make a list.
 * - `default`: values for keys the input lacks; `*` applies to every key there.
 * - `remove`: the keys the spec names (`*` for all).
 * - `cardinality`: `ONE` (a list's first item) or `MANY` (a value as a list of one).
 * - `sort`: keys in alphabetical order, all the way down.
 * - `modify-overwrite-beta`, `modify-default-beta`, `modify-define-beta`: values set from literals, references
 *   (`@(n,path)`) or functions (`=toUpper`, `=concat(@(1,a),'-',@(1,b))`, `=split(',',@(1,list))`…), always, when
 *   missing or null, or when missing.
 */

type Json = unknown;
type Obj = Record<string, Json>;

export type JoltOperationName =
    | 'shift' | 'default' | 'remove' | 'cardinality' | 'sort'
    | 'modify-overwrite-beta' | 'modify-default-beta' | 'modify-define-beta';
export interface JoltOperation { operation: JoltOperationName; spec?: Json }

export class JoltError extends Error {}

const isObj = (v: Json): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const entries = (v: Json): [string, Json][] => Array.isArray(v) ? v.map((x, i) => [String(i), x]) : isObj(v) ? Object.entries(v) : [];
const clone = <T>(v: T): T => v === undefined ? v : JSON.parse(JSON.stringify(v));

/** Runs the chain on `input`; the input is not changed. */
export function joltTransform(input: Json, chain: JoltOperation[]): Json {
    let v = clone(input);
    for (const op of chain) {
        switch (op.operation) {
            case 'shift': v = shift(v, op.spec); break;
            case 'default': v = applyDefault(v, op.spec); break;
            case 'remove': v = remove(v, op.spec); break;
            case 'cardinality': v = cardinality(v, op.spec); break;
            case 'sort': v = sortKeys(v); break;
            case 'modify-overwrite-beta': v = modify(v, op.spec, 'overwrite'); break;
            case 'modify-default-beta': v = modify(v, op.spec, 'default'); break;
            case 'modify-define-beta': v = modify(v, op.spec, 'define'); break;
            default: throw new JoltError(`Unknown operation "${(op as { operation: string }).operation}".`);
        }
    }
    return v;
}

const OPERATIONS = new Set<string>(['shift', 'default', 'remove', 'cardinality', 'sort', 'modify-overwrite-beta', 'modify-default-beta', 'modify-define-beta']);

/** What is wrong with a chain as written (JSON text or parsed): not a list, an unknown operation, a spec of the wrong shape. */
export function joltProblems(chain: Json): string[] {
    if (typeof chain === 'string') {
        try { chain = JSON.parse(chain); } catch (e) { return [`Not JSON: ${e instanceof Error ? e.message : String(e)}`]; }
    }
    const list = Array.isArray(chain) ? chain : [chain];
    const out: string[] = [];
    list.forEach((op, i) => {
        const where = `Operation ${i + 1}`;
        if (!isObj(op)) { out.push(`${where} is not an object with "operation" and "spec".`); return; }
        if (typeof op.operation !== 'string' || !OPERATIONS.has(op.operation)) { out.push(`${where}: "${String(op.operation)}" is not an operation (${[...OPERATIONS].join(', ')}).`); return; }
        if (op.operation !== 'sort' && !isObj(op.spec)) out.push(`${where} (${op.operation}): its spec must be an object.`);
        if (op.operation === 'modify-overwrite-beta' || op.operation === 'modify-default-beta' || op.operation === 'modify-define-beta') {
            for (const f of functionNames(op.spec)) if (!FUNCTIONS[f]) out.push(`${where}: =${f} is not a function here.`);
        }
    });
    return out;
}

/** A chain from its text: one operation or a list of them. Throws `JoltError` with the first problem. */
export function parseJolt(text: string): JoltOperation[] {
    const problems = joltProblems(text);
    if (problems.length) throw new JoltError(problems[0]);
    const v = JSON.parse(text);
    return (Array.isArray(v) ? v : [v]) as JoltOperation[];
}

// ---- shift ----

/** One level of the input walked: the key matched, its wildcard captures, its value. */
interface Level { key: string; captures: string[]; value: Json }

/** A spec key that matches input keys, and how it reads them. */
interface Matcher { key: string; spec: Json; test: (k: string) => string[] | null; rank: number }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matcherOf(key: string, spec: Json): Matcher {
    const alternatives = key.split('|');
    const res = alternatives.map(a => new RegExp(`^${a.split('*').map(escapeRe).join('(.*?)')}$`));
    const literal = !key.includes('*') && !key.includes('|');
    return {
        key, spec,
        test: k => { for (const re of res) { const m = re.exec(k); if (m) return [k, ...m.slice(1)]; } return null; },
        // Literal keys win, then alternatives, then wildcards with the most fixed text, then a bare `*`.
        rank: literal ? 3e6 : !key.includes('*') ? 2e6 : 1e6 + key.replace(/\*/g, '').length,
    };
}

function shift(input: Json, spec: Json): Json {
    const out: { root?: Json } = {};
    walk(spec, input, [{ key: 'root', captures: ['root'], value: input }], out);
    return out.root ?? null;
}

function walk(spec: Json, input: Json, levels: Level[], out: { root?: Json }) {
    if (!isObj(spec)) return;
    const matchers: Matcher[] = [];
    for (const [key, sub] of Object.entries(spec)) {
        if (key === '@' || key.startsWith('@(')) {
            const value = key === '@' ? input : lookup(key, levels);
            if (value !== undefined) apply(sub, value, levels, out, false);
        } else if (key === '$' || /^\$\d+$/.test(key)) {
            const n = key === '$' ? 0 : Number(key.slice(1));
            const level = levels[levels.length - 1 - n];
            if (level) writeAll(sub, level.key, levels, out);
        } else if (key.startsWith('#')) {
            writeAll(sub, key.slice(1), levels, out);
        } else {
            matchers.push(matcherOf(key, sub));
        }
    }
    matchers.sort((a, b) => b.rank - a.rank);
    for (const [k, v] of entries(input)) {
        for (const m of matchers) {
            const captures = m.test(k);
            if (!captures) continue;
            apply(m.spec, v, [...levels, { key: k, captures, value: v }], out, true);
            break;
        }
    }
}

/** A spec value: output paths to write the value to, or a spec to walk into it. */
function apply(spec: Json, value: Json, levels: Level[], out: { root?: Json }, _pushed: boolean) {
    if (typeof spec === 'string' || Array.isArray(spec)) writeAll(spec, value, levels, out);
    else if (isObj(spec)) walk(spec, value, levels, out);
}

function writeAll(spec: Json, value: Json, levels: Level[], out: { root?: Json }) {
    const paths = typeof spec === 'string' ? [spec] : Array.isArray(spec) ? spec.filter((p): p is string => typeof p === 'string') : [];
    for (const p of paths) write(out, resolvePath(p, levels), value);
}

/** `@(n,a.b)`: the value `n` levels up, then down the path. `@(n)` or `@n`: that level's value. */
function lookup(ref: string, levels: Level[]): Json {
    const m = /^@\(?(\d+)(?:,([^)]*))?\)?$/.exec(ref.trim()) ?? /^@\((.*)\)$/.exec(ref.trim());
    if (!m) return undefined;
    const n = Number(m[1]);
    const level = levels[levels.length - 1 - (Number.isFinite(n) ? n : 0)];
    if (!level) return undefined;
    return dig(level.value, m[2]);
}

function dig(v: Json, path?: string): Json {
    if (!path) return v;
    for (const k of path.split('.').filter(Boolean)) {
        if (Array.isArray(v)) v = v[Number(k)];
        else if (isObj(v)) v = v[k];
        else return undefined;
    }
    return v;
}

type Step = { key: string } | { index: number } | { append: true };

/** An output path's steps: `a.&1.b[]`, `out[#2].id`, `@(1,id).name`. Dots inside `@(…)` don't split. */
function resolvePath(path: string, levels: Level[]): Step[] {
    const parts: string[] = [];
    let depth = 0, cur = '';
    for (const c of path) {
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (c === '.' && depth === 0) { parts.push(cur); cur = ''; } else cur += c;
    }
    parts.push(cur);
    const steps: Step[] = [];
    const amp = (s: string) => s.replace(/&\((\d+),(\d+)\)|&(\d+)|&/g, (_, a, b, c) => {
        const n = a !== undefined ? Number(a) : c !== undefined ? Number(c) : 0;
        const level = levels[levels.length - 1 - n];
        return level ? (level.captures[b !== undefined ? Number(b) : 0] ?? '') : '';
    });
    for (const part of parts) {
        if (part === '') continue;
        const m = /^(.*?)((?:\[[^\]]*\])*)$/.exec(part)!;
        let name = m[1];
        if (name.startsWith('@(') || /^@\d/.test(name)) name = String(lookup(name, levels) ?? '');
        else name = amp(name);
        if (name !== '') steps.push({ key: name });
        for (const br of m[2].match(/\[[^\]]*\]/g) ?? []) {
            const inner = br.slice(1, -1);
            if (inner === '') steps.push({ append: true });
            else if (/^#\d+$/.test(inner)) {
                const level = levels[levels.length - Number(inner.slice(1))];
                steps.push({ index: level ? Number(level.key) || 0 : 0 });
            } else steps.push({ index: Number(amp(inner)) || 0 });
        }
    }
    return steps;
}

/** Writes at the path; a second value at one place makes a list (as JOLT does). */
function write(out: { root?: Json }, steps: Step[], value: Json) {
    let parent: Obj | Json[] = out as Obj;
    let key: string | number = 'root';
    const at = () => (parent as Record<string | number, Json>)[key];
    const set = (v: Json) => { (parent as Record<string | number, Json>)[key] = v; };
    for (const step of steps) {
        if ('key' in step) {
            if (!isObj(at())) set({});
            parent = at() as Obj;
            key = step.key;
        } else {
            if (!Array.isArray(at())) set(at() === undefined ? [] : [at()]);
            const list = at() as Json[];
            parent = list;
            key = 'append' in step ? list.length : step.index;
        }
    }
    const existing = at();
    if (existing === undefined) set(clone(value));
    else if (Array.isArray(existing) && !Array.isArray(value)) existing.push(clone(value));
    else set([existing, clone(value)]);
}

// ---- default, remove, cardinality, sort ----

function applyDefault(input: Json, spec: Json): Json {
    if (!isObj(spec)) return input;
    const target = isObj(input) || Array.isArray(input) ? input : {};
    const keys = (k: string) => k === '*' ? entries(target).map(([x]) => x) : k.split('|');
    for (const [rawKey, sub] of Object.entries(spec)) {
        const list = rawKey.endsWith('[]');
        const k = list ? rawKey.slice(0, -2) : rawKey;
        for (const key of keys(k)) {
            const t = target as Record<string, Json>;
            if (isObj(sub)) t[key] = applyDefault(t[key] ?? (list ? [] : {}), sub);
            else if (t[key] === undefined || t[key] === null) t[key] = clone(sub);
        }
    }
    return target;
}

function remove(input: Json, spec: Json): Json {
    if (!isObj(spec) || (!isObj(input) && !Array.isArray(input))) return input;
    const drop: string[] = [];
    for (const [k, sub] of Object.entries(spec)) {
        for (const [key, v] of entries(input)) {
            if (!matcherOf(k, sub).test(key)) continue;
            if (isObj(sub)) remove(v, sub); else drop.push(key);
        }
    }
    if (Array.isArray(input)) return input.filter((_, i) => !drop.includes(String(i)));
    for (const k of drop) delete (input as Obj)[k];
    return input;
}

function cardinality(input: Json, spec: Json): Json {
    if (!isObj(spec) || !isObj(input)) return input;
    for (const [k, sub] of Object.entries(spec)) {
        for (const [key] of entries(input)) {
            if (!matcherOf(k, sub).test(key)) continue;
            const v = input[key];
            if (isObj(sub)) input[key] = Array.isArray(v) ? v.map(x => cardinality(x, sub)) : cardinality(v, sub);
            else if (sub === 'ONE' && Array.isArray(v)) input[key] = v.length ? v[0] : null;
            else if (sub === 'MANY' && !Array.isArray(v)) input[key] = v === null || v === undefined ? [] : [v];
        }
    }
    return input;
}

function sortKeys(v: Json): Json {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (!isObj(v)) return v;
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
}

// ---- modify ----

type Mode = 'overwrite' | 'default' | 'define';

function modify(input: Json, spec: Json, mode: Mode, levels: Level[] = []): Json {
    if (!isObj(spec)) return input;
    const target = isObj(input) || Array.isArray(input) ? input : {};
    const here: Level[] = levels.length ? levels : [{ key: 'root', captures: ['root'], value: target }];
    for (const [rawKey, sub] of Object.entries(spec)) {
        const list = rawKey.endsWith('[]');
        const k = list ? rawKey.slice(0, -2) : rawKey;
        const keys = k.includes('*') || k.includes('|')
            ? entries(target).map(([x]) => x).filter(x => matcherOf(k, sub).test(x))
            : [k];
        for (const key of keys) {
            const t = target as Record<string, Json>;
            const current = t[key];
            const level: Level = { key, captures: matcherOf(k, sub).test(key) ?? [key], value: current };
            if (isObj(sub)) {
                // A list's items are its keys "0", "1"…: `*` in the spec matches them, as in JOLT.
                const base = current ?? (list ? [] : {});
                t[key] = modify(base, sub, mode, [...here, { ...level, value: base }]);
                continue;
            }
            const missing = !(key in (t as object)) || current === undefined;
            if (mode === 'default' && !missing && current !== null) continue;
            if (mode === 'define' && !missing) continue;
            t[key] = evaluate(sub, current, [...here, level]);
        }
    }
    return target;
}

/** A modify value: a literal, a reference (`@(1,a)`), or a function (`=toUpper`, `=concat(…)`). */
function evaluate(expr: Json, current: Json, levels: Level[]): Json {
    if (typeof expr !== 'string') return clone(expr);
    // `@(1,a)` from a key being set is its sibling `a`: one level up from the key.
    if (expr.startsWith('@')) return clone(lookup(expr, levels));
    if (!expr.startsWith('=')) return expr;
    const m = /^=([A-Za-z]+)(?:\((.*)\))?$/.exec(expr.trim());
    if (!m) return expr;
    const fn = FUNCTIONS[m[1]];
    if (!fn) throw new JoltError(`=${m[1]} is not a function here.`);
    const args = m[2] === undefined ? [current] : splitArgs(m[2]).map(a => arg(a, current, levels));
    return fn(args);
}

/** Arguments split on commas outside quotes and brackets. */
function splitArgs(s: string): string[] {
    const out: string[] = [];
    let depth = 0, quote = false, cur = '';
    for (const c of s) {
        if (c === "'" ) quote = !quote;
        if (!quote && c === '(') depth++;
        if (!quote && c === ')') depth--;
        if (c === ',' && depth === 0 && !quote) { out.push(cur.trim()); cur = ''; } else cur += c;
    }
    if (cur.trim() !== '' || out.length) out.push(cur.trim());
    return out;
}

function arg(a: string, current: Json, levels: Level[]): Json {
    if (/^'.*'$/s.test(a)) return a.slice(1, -1);
    if (a === '@' || a === '@0') return current;
    if (a.startsWith('@')) return lookup(a, levels);
    if (a.startsWith('=')) return evaluate(a, current, levels);
    if (a !== '' && Number.isFinite(Number(a))) return Number(a);
    if (a === 'true' || a === 'false') return a === 'true';
    if (a === 'null') return null;
    return a;
}

const num = (v: Json) => typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
const str = (v: Json) => v === null || v === undefined ? '' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
const flat = (args: Json[]) => args.flatMap(a => Array.isArray(a) ? a : [a]);
const squash = (v: Json): Json => Array.isArray(v) ? v.filter(x => x !== null && x !== undefined) : isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined)) : v;
const squashAll = (v: Json): Json => {
    const s = squash(v);
    return Array.isArray(s) ? s.map(squashAll) : isObj(s) ? Object.fromEntries(Object.entries(s).map(([k, x]) => [k, squashAll(x)])) : s;
};

/** The modify functions, by name; each takes its arguments (the current value when none are written). */
const FUNCTIONS: Record<string, (args: Json[]) => Json> = {
    toString: ([v]: Json[]) => Array.isArray(v) ? v.map(str) : str(v),
    toLower: ([v]: Json[]) => Array.isArray(v) ? v.map(x => str(x).toLowerCase()) : str(v).toLowerCase(),
    toUpper: ([v]: Json[]) => Array.isArray(v) ? v.map(x => str(x).toUpperCase()) : str(v).toUpperCase(),
    trim: ([v]: Json[]) => Array.isArray(v) ? v.map(x => str(x).trim()) : str(v).trim(),
    toInteger: ([v]: Json[]) => { const n = num(v); return n === undefined ? v : Math.trunc(n); },
    toLong: ([v]: Json[]) => { const n = num(v); return n === undefined ? v : Math.trunc(n); },
    toDouble: ([v]: Json[]) => num(v) ?? v,
    toBoolean: ([v]: Json[]) => typeof v === 'boolean' ? v : str(v).trim().toLowerCase() === 'true' ? true : str(v).trim().toLowerCase() === 'false' ? false : v,
    toList: ([v]: Json[]) => Array.isArray(v) ? v : v === null || v === undefined ? [] : [v],
    concat: (args: Json[]) => flat(args).map(str).join(''),
    join: ([sep, ...rest]: Json[]) => flat(rest).filter(x => x !== null && x !== undefined).map(str).join(str(sep)),
    split: ([sep, v]: Json[]) => typeof v === 'string' ? v.split(new RegExp(str(sep))) : v,
    substring: ([v, start, end]: Json[]) => typeof v === 'string' ? v.substring(num(start) ?? 0, end === undefined ? undefined : num(end)) : v,
    leftPad: ([v, width, pad]: Json[]) => str(v).padStart(num(width) ?? 0, str(pad) || ' '),
    rightPad: ([v, width, pad]: Json[]) => str(v).padEnd(num(width) ?? 0, str(pad) || ' '),
    size: ([v]: Json[]) => Array.isArray(v) ? v.length : typeof v === 'string' ? v.length : isObj(v) ? Object.keys(v).length : null,
    firstElement: ([v]: Json[]) => Array.isArray(v) ? v[0] ?? null : v,
    lastElement: ([v]: Json[]) => Array.isArray(v) ? v[v.length - 1] ?? null : v,
    elementAt: ([i, v]: Json[]) => Array.isArray(v) ? v[num(i) ?? 0] ?? null : null,
    squashNulls: ([v]: Json[]) => squash(v),
    recursivelySquashNulls: ([v]: Json[]) => squashAll(v),
    abs: ([v]: Json[]) => { const n = num(v); return n === undefined ? v : Math.abs(n); },
    min: (args: Json[]) => { const ns = flat(args).map(num).filter((n): n is number => n !== undefined); return ns.length ? Math.min(...ns) : null; },
    max: (args: Json[]) => { const ns = flat(args).map(num).filter((n): n is number => n !== undefined); return ns.length ? Math.max(...ns) : null; },
    intSum: (args: Json[]) => Math.trunc(flat(args).reduce<number>((s, x) => s + (num(x) ?? 0), 0)),
    longSum: (args: Json[]) => Math.trunc(flat(args).reduce<number>((s, x) => s + (num(x) ?? 0), 0)),
    doubleSum: (args: Json[]) => flat(args).reduce<number>((s, x) => s + (num(x) ?? 0), 0),
    divide: ([a, b]: Json[]) => { const x = num(a), y = num(b); return x === undefined || !y ? null : x / y; },
    divideAndRound: ([scale, a, b]: Json[]) => { const x = num(a), y = num(b), s = num(scale) ?? 0; return x === undefined || !y ? null : Number((x / y).toFixed(s)); },
    multiply: (args: Json[]) => flat(args).reduce<number>((p, x) => p * (num(x) ?? 1), 1),
    noop: ([v]: Json[]) => v,
};

/** The function names a modify spec calls, at any depth. */
function functionNames(spec: Json): string[] {
    const out: string[] = [];
    const visit = (v: Json) => {
        if (typeof v === 'string') for (const m of v.matchAll(/=([A-Za-z]+)/g)) out.push(m[1]);
        else if (Array.isArray(v)) v.forEach(visit);
        else if (isObj(v)) Object.values(v).forEach(visit);
    };
    visit(spec);
    return [...new Set(out)];
}
