/**
 * One field's value on one page, as the backend will see it: the raw value read, its cleanup steps run,
 * then checked against the field's type and whether it is required (`docs/design/LLD.md` §7.3).
 */
import { parseAs, type FieldType as ChainType } from '../../shared/transforms/chain';
import { applyProOps } from '../recipe/ops';
import type { Field } from '../recipe/types';

export interface FieldCheck {
    /** The value after cleanup, typed where the type parses (money → amount, date → ISO). */
    value: unknown;
    /** The value after cleanup, before typing: what the output contract converts. */
    cleaned: unknown;
    /** A value was found. */
    filled: boolean;
    /** Filled and of its type, or empty and not required. */
    ok: boolean;
    /** Why it is not ok, in a few words. */
    problem?: string;
    currency?: string | null;
}

const PARSED: Partial<Record<Field['type'], ChainType>> = {
    number: 'number', integer: 'integer', money: 'money', date: 'date', url: 'url', boolean: 'boolean',
};

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
    || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

/** A list or table arrives from the page as JSON text: read it back as the value it is. */
function unwrap(raw: unknown): unknown {
    if (typeof raw !== 'string' || !/^\s*[[{]/.test(raw)) return raw;
    try { return JSON.parse(raw); } catch { return raw; }
}

export function checkField(field: Field, raw: unknown, baseUrl?: string): FieldCheck {
    const cleaned = applyProOps(unwrap(raw), field.ops, baseUrl);
    if (isEmpty(cleaned)) {
        return { value: null, cleaned: null, filled: false, ok: !field.required, ...(field.required ? { problem: 'required, but empty' } : {}) };
    }
    return { cleaned, ...typed(field, cleaned, baseUrl) };
}

function typed(field: Field, cleaned: unknown, baseUrl?: string): Omit<FieldCheck, 'cleaned'> {
    const parsedType = PARSED[field.type];
    if (parsedType) {
        if (typeof cleaned === 'number' && parsedType !== 'url' && parsedType !== 'boolean') return { value: cleaned, filled: true, ok: true };
        const parsed = typeof cleaned === 'string' ? parseAs(parsedType, cleaned, { baseUrl }) : undefined;
        return parsed
            ? { value: parsed.value, filled: true, ok: true, ...(parsed.currency !== undefined ? { currency: parsed.currency } : {}) }
            : { value: cleaned, filled: true, ok: false, problem: `not a ${field.type}` };
    }
    if (field.type === 'list' || field.type === 'table') {
        return Array.isArray(cleaned) ? { value: cleaned, filled: true, ok: true } : { value: cleaned, filled: true, ok: false, problem: `not a ${field.type}` };
    }
    if (field.type === 'object') {
        const ok = typeof cleaned === 'object' && cleaned !== null && !Array.isArray(cleaned);
        return { value: cleaned, filled: true, ok, ...(ok ? {} : { problem: 'not an object' }) };
    }
    return { value: cleaned, filled: true, ok: true };
}
