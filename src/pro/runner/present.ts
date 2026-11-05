/**
 * A field's result as Check shows it (`docs/plans/pro-ops-workflow-review.md`): the value as the crawler will output
 * it, typed (money with its currency, a date as the date understood), whether it checks out for its type, and where
 * it came from.
 */
import type { Field } from '../recipe/types';
import type { FieldResult } from './readPage';

const MAX_TEXT = 160;

/** The value as output, in one line. */
export function shownValue(f: FieldResult, type: Field['type']): string {
    if (!f.filled) return '—';
    const v = f.value;
    if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}: ${v.slice(0, 3).map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(', ')}${v.length > 3 ? ', …' : ''}`;
    if (v && typeof v === 'object') return JSON.stringify(v).slice(0, MAX_TEXT);
    if (!f.ok) return String(f.cleaned ?? v ?? '').slice(0, MAX_TEXT);
    if (type === 'money' && typeof v === 'number') return `${v.toFixed(2)}${f.currency ? ` ${f.currency}` : ''}`;
    if (type === 'boolean') return v ? 'yes' : 'no';
    return String(v).slice(0, MAX_TEXT);
}

export interface Verdict {
    tone: 'ok' | 'bad' | 'empty';
    text: string;
}

/** Does the value check out: of its type, and there when required. */
export function verdictOf(f: FieldResult, type: Field['type']): Verdict {
    if (!f.ok) return { tone: 'bad', text: f.problem ?? `not a ${type}` };
    if (!f.filled) return { tone: 'empty', text: 'empty' };
    if (type === 'money') return { tone: 'ok', text: f.currency ? `money, ${f.currency}` : 'money, no currency' };
    return { tone: 'ok', text: type };
}

/** Where the value came from. */
export function sourceOf(status: FieldResult['status']): string {
    switch (status) {
        case 'data': return 'page data';
        case 'ok': return 'selector';
        case 'healed': return 'selector, healed';
        default: return 'not found';
    }
}
