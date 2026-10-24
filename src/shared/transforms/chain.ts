/**
 * Field types and transform chains: a column's raw text goes through a list of small steps
 * (trim, regex, replace, split…) and ends in a typed parse. Steps are data, so they are saved with
 * the table and shown as editable chips with before → after.
 */
import { cleanUrl, parseBoolean, parseCount, parseDate, parseMoney, parseNumber, parsePercent, parseRating } from './parsers';

export type FieldType = 'text' | 'money' | 'number' | 'integer' | 'percent' | 'rating' | 'count' | 'date' | 'url' | 'boolean';

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
    text: 'Text', money: 'Money', number: 'Number', integer: 'Whole number', percent: 'Percent',
    rating: 'Rating (0–5)', count: 'Count', date: 'Date', url: 'URL', boolean: 'Yes / No',
};

export type TransformOp =
    | { op: 'trim' }
    | { op: 'collapse' }
    | { op: 'lower' }
    | { op: 'upper' }
    | { op: 'regex'; pattern: string; group?: number }
    | { op: 'replace'; find: string; with: string; regex?: boolean }
    | { op: 'split'; sep: string; index: number }
    | { op: 'prefix'; text: string }
    | { op: 'suffix'; text: string }
    | { op: 'stripHtml' }
    | { op: 'absoluteUrl' };

export const OP_LABELS: Record<TransformOp['op'], string> = {
    trim: 'Trim', collapse: 'Collapse spaces', lower: 'Lowercase', upper: 'Uppercase', regex: 'Extract (regex)',
    replace: 'Replace', split: 'Split & pick', prefix: 'Add prefix', suffix: 'Add suffix',
    stripHtml: 'Remove HTML tags', absoluteUrl: 'Full URL',
};

export interface StepResult {
    label: string;
    value: string;
}

export interface ChainResult {
    /** Typed output (string for text, number, ISO date string, boolean, URL string, Money). */
    value: unknown;
    /** For money: the currency (kept separate so tables and CSV stay flat). */
    currency?: string | null;
    ok: boolean;
    steps: StepResult[];
}

/** `base`: the page's address, for `absoluteUrl` (a relative link made whole). */
function applyOp(v: string, o: TransformOp, base?: string): string {
    switch (o.op) {
        case 'trim': return v.trim();
        case 'collapse': return v.replace(/\s+/g, ' ').trim();
        case 'lower': return v.toLowerCase();
        case 'upper': return v.toUpperCase();
        case 'regex': {
            try {
                const m = new RegExp(o.pattern, 'i').exec(v);
                return m ? (m[o.group ?? (m.length > 1 ? 1 : 0)] ?? '') : '';
            } catch { return v; }
        }
        case 'replace': {
            if (!o.find) return v;
            if (o.regex) {
                try { return v.replace(new RegExp(o.find, 'gi'), o.with); } catch { return v; }
            }
            return v.split(o.find).join(o.with);
        }
        case 'split': {
            const parts = v.split(o.sep || ',');
            const i = o.index < 0 ? parts.length + o.index : o.index;
            return (parts[i] ?? '').trim();
        }
        case 'prefix': return o.text + v;
        case 'suffix': return v + o.text;
        case 'stripHtml':
            return v.replace(/<(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        case 'absoluteUrl': {
            // Only what is written as a path (`/p/1`, `//cdn…`, `../a.jpg`): plain text stays text.
            if (!/^(\/|\.\.?\/)/.test(v)) return v;
            try { return new URL(v, base).href; } catch { return v; }
        }
    }
}

/** Text steps on one value (no typed parse): what a field bound to the page's data runs on what it reads. */
export function applyOps(v: string, ops: TransformOp[], base?: string): string {
    return ops.reduce((acc, o) => applyOp(acc, o, base), v);
}

export function parseAs(type: FieldType, v: string, ctx: { baseUrl?: string; dayFirst?: boolean } = {}): { value: unknown; currency?: string | null } | undefined {
    switch (type) {
        case 'text': return { value: v };
        case 'money': {
            const m = parseMoney(v);
            return m ? { value: m.amount, currency: m.currency } : undefined;
        }
        case 'number': {
            const n = parseNumber(v);
            return n === undefined ? undefined : { value: n };
        }
        case 'integer': {
            const n = parseNumber(v);
            return n === undefined ? undefined : { value: Math.round(n) };
        }
        case 'percent': {
            const n = parsePercent(v);
            return n === undefined ? undefined : { value: n };
        }
        case 'rating': {
            const n = parseRating(v);
            return n === undefined ? undefined : { value: n };
        }
        case 'count': {
            const n = parseCount(v);
            return n === undefined ? undefined : { value: n };
        }
        case 'date': {
            const d = parseDate(v, { dayFirst: ctx.dayFirst });
            return d === undefined ? undefined : { value: d };
        }
        case 'url': {
            const u = cleanUrl(v, ctx.baseUrl);
            return u === undefined ? undefined : { value: u };
        }
        case 'boolean': {
            const b = parseBoolean(v);
            return b === undefined ? undefined : { value: b };
        }
    }
}

export function applyChain(raw: unknown, type: FieldType, ops: TransformOp[], ctx: { baseUrl?: string; dayFirst?: boolean } = {}): ChainResult {
    if (raw === null || raw === undefined || raw === '') return { value: null, ok: true, steps: [] };
    if (typeof raw === 'number' && ops.length === 0 && type !== 'text') {
        return { value: raw, ok: true, steps: [] };
    }
    let v = typeof raw === 'string' ? raw : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
    const steps: StepResult[] = [];
    for (const o of ops) {
        v = applyOp(v, o, ctx.baseUrl);
        steps.push({ label: OP_LABELS[o.op], value: v });
    }
    if (v === '') return { value: null, ok: true, steps };
    const parsed = parseAs(type, v, ctx);
    if (!parsed) return { value: null, ok: false, steps };
    return { value: parsed.value, currency: parsed.currency, ok: true, steps };
}
