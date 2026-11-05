/**
 * A field's value checks (`ValueCheck`, `docs/plans/pro-rules-assertions-plan.md`, R4): each one on the value once
 * cleaned and typed, said in a few words when it fails ("not like /^LX-\d+$/", "above 1000", "more than
 * list_price"). One-field checks run with the field (`runner/check.ts`); comparisons with another field run once
 * the page's fields are all read (`runner/readPage.ts`). A list's items are checked one by one, except for length.
 */
import type { CompareOp, Field, ValueCheck } from './types';

const OP_WORDS: Record<CompareOp, string> = { lt: 'less than', lte: 'at most', eq: 'equal to', ne: 'not equal to', gte: 'at least', gt: 'more than' };
export const COMPARE_OPS = (Object.keys(OP_WORDS) as CompareOp[]).map(value => ({ value, label: OP_WORDS[value] }));

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const asNumber = (v: unknown): number | undefined => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return undefined;
};
const text = (v: unknown) => typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
const items = (v: unknown): unknown[] => Array.isArray(v) ? v : [v];

/** Why `value` fails the check, or null. `value`: typed (a money amount); `cleaned`: the text before typing. */
export function failsCheck(check: ValueCheck, value: unknown, cleaned: unknown): string | null {
    switch (check.kind) {
        case 'pattern': {
            let re: RegExp;
            try { re = new RegExp(check.pattern, (check.flags ?? '').replace(/[gy]/g, '')); } catch { return `pattern /${check.pattern}/ is not a valid regex`; }
            const bad = items(cleaned).find(x => re.test(text(x)) === !!check.not);
            return bad === undefined ? null : check.not ? `like /${check.pattern}/` : `not like /${check.pattern}/`;
        }
        case 'range': {
            for (const x of items(value)) {
                const n = asNumber(x);
                if (n === undefined) return 'not a number to compare';
                if (check.min !== undefined && n < check.min) return `below ${check.min}`;
                if (check.max !== undefined && n > check.max) return `above ${check.max}`;
            }
            return null;
        }
        case 'oneOf': {
            const listed = check.values.filter(v => v.trim());
            const allowed = new Set(listed.map(norm));
            const bad = items(cleaned).find(x => !allowed.has(norm(text(x))));
            return bad === undefined ? null : `"${text(bad)}" is not one of ${listed.join(', ')}`;
        }
        case 'length': {
            const n = Array.isArray(cleaned) ? cleaned.length : text(cleaned).length;
            const unit = Array.isArray(cleaned) ? 'items' : 'characters';
            if (check.min !== undefined && n < check.min) return `${n} ${unit}, fewer than ${check.min}`;
            if (check.max !== undefined && n > check.max) return `${n} ${unit}, more than ${check.max}`;
            return null;
        }
        case 'compare':
            return null;
    }
}

/** Whether `a op b` holds: as numbers when both are, else as text (ISO dates order as text). */
export function compareHolds(op: CompareOp, a: unknown, b: unknown): boolean {
    const na = asNumber(a), nb = asNumber(b);
    const [x, y] = na !== undefined && nb !== undefined ? [na, nb] : [text(a), text(b)];
    switch (op) {
        case 'lt': return x < y;
        case 'lte': return x <= y;
        case 'eq': return x === y;
        case 'ne': return x !== y;
        case 'gte': return x >= y;
        case 'gt': return x > y;
    }
}

/** Why the comparison with the other field fails, or null. */
export function failsCompare(check: Extract<ValueCheck, { kind: 'compare' }>, value: unknown, other: unknown): string | null {
    return compareHolds(check.op, value, other) ? null : `not ${OP_WORDS[check.op]} ${check.field} (${text(value)} vs ${text(other)})`;
}

/** The check as a short sentence: "matches /^LX-/", "between 1 and 1000", "at most list_price". */
export function describeCheck(c: ValueCheck): string {
    switch (c.kind) {
        case 'pattern': return `${c.not ? 'does not match' : 'matches'} /${c.pattern}/${c.flags ?? ''}`;
        case 'range': return c.min !== undefined && c.max !== undefined ? `between ${c.min} and ${c.max}` : c.min !== undefined ? `at least ${c.min}` : c.max !== undefined ? `at most ${c.max}` : 'any number';
        case 'oneOf': return `one of ${c.values.filter(v => v.trim()).join(', ') || '(none yet)'}`;
        case 'length': return c.min !== undefined && c.max !== undefined ? `length ${c.min} to ${c.max}` : c.min !== undefined ? `length at least ${c.min}` : c.max !== undefined ? `length at most ${c.max}` : 'any length';
        case 'compare': return `${OP_WORDS[c.op]} ${c.field || '(a field)'}`;
    }
}

/** What a field's checks lack before the recipe can be saved. */
export function checkProblems(field: Field, names: string[]): string[] {
    const out: string[] = [];
    const where = `"${field.name}"`;
    for (const c of field.checks ?? []) {
        if (c.kind === 'pattern') {
            if (!c.pattern) out.push(`${where}: a pattern check has no pattern.`);
            else try { new RegExp(c.pattern, (c.flags ?? '').replace(/[gy]/g, '')); } catch { out.push(`${where}: /${c.pattern}/ is not a valid regex.`); }
        } else if (c.kind === 'range' || c.kind === 'length') {
            if (c.min === undefined && c.max === undefined) out.push(`${where}: a ${c.kind} check needs a minimum or a maximum.`);
            else if (c.min !== undefined && c.max !== undefined && c.min > c.max) out.push(`${where}: a ${c.kind} check's minimum is above its maximum.`);
        } else if (c.kind === 'oneOf') {
            if (!c.values.some(v => v.trim())) out.push(`${where}: a "one of" check has no values.`);
        } else if (c.kind === 'compare') {
            if (!names.includes(c.field)) out.push(`${where}: compares with "${c.field}", which is not a field.`);
            else if (c.field === field.name) out.push(`${where}: compares with itself.`);
        }
    }
    return out;
}
