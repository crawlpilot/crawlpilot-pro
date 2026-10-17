/**
 * Column type detection: tries each type on all of a column's values and keeps the most specific one
 * that parses nearly all of them. Deterministic, no model.
 */
import { FieldType, parseAs } from './chain';
import { parseMoney } from './parsers';

export interface DetectedType {
    type: FieldType;
    /** Share of non-empty values that parse as this type (0–1). */
    coverage: number;
    /** Most common currency for money. */
    currency?: string | null;
    /** Plain description, e.g. "money (USD)". */
    label: string;
}

const MIN_COVERAGE = 0.85;
const MONEY_HINT = /[$€£¥₹₩₽₺₪₫₱฿]|\b(USD|EUR|GBP|JPY|INR|CAD|AUD|CHF|SEK|PLN|BRL|MXN)\b/i;
const PURE_NUMBER = /^[-+]?[\d.,\s]+$/;

/** Order matters: more specific first. */
const CANDIDATES: FieldType[] = ['url', 'date', 'percent', 'money', 'rating', 'count', 'integer', 'number', 'boolean'];

export function detectType(values: unknown[], columnName = ''): DetectedType {
    const strings = values
        .filter(v => v !== null && v !== undefined && v !== '')
        .map(v => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''))
        .filter(Boolean)
        .slice(0, 300);
    if (strings.length === 0) return { type: 'text', coverage: 0, label: 'text' };

    const share = (pred: (s: string) => boolean) => strings.filter(pred).length / strings.length;
    const name = columnName.toLowerCase();

    for (const type of CANDIDATES) {
        let cov: number;
        switch (type) {
            case 'url':
                cov = share(s => /^(https?:\/\/|\/[^\s]*$|www\.)/i.test(s) && !/\s/.test(s));
                break;
            case 'date':
                // Pure numbers ("2024", "12") are not dates.
                cov = share(s => !PURE_NUMBER.test(s) && parseAs('date', s) !== undefined);
                break;
            case 'percent':
                cov = share(s => /%/.test(s) && parseAs('percent', s) !== undefined);
                break;
            case 'money':
                cov = share(s => MONEY_HINT.test(s) && parseMoney(s) !== null);
                if (cov < MIN_COVERAGE && /price|cost|amount|total|fee|salary|msrp/.test(name)) {
                    cov = share(s => parseMoney(s) !== null && /\d/.test(s) && s.length < 40);
                }
                break;
            case 'rating':
                cov = share(s => /(out of|\/\s*5|stars?|rated)/i.test(s) && parseAs('rating', s) !== undefined);
                if (cov < MIN_COVERAGE && /rating|stars|score/.test(name)) {
                    cov = share(s => parseAs('rating', s) !== undefined && s.length < 30);
                }
                break;
            case 'count':
                cov = share(s => /\d\s*[kKmM]\+?\b|\d[\d,]*\s+(ratings?|reviews?|sold|bought|views?|followers?|likes?|comments?|results?)/i.test(s));
                if (cov < MIN_COVERAGE && /reviews?|ratings?_?count|count|sold|views|followers/.test(name)) {
                    cov = share(s => parseAs('count', s) !== undefined && s.length < 40);
                }
                break;
            case 'integer':
                cov = share(s => /^[-+]?\d{1,3}([,\s]\d{3})*$|^[-+]?\d+$/.test(s));
                break;
            case 'number':
                cov = share(s => PURE_NUMBER.test(s) && parseAs('number', s) !== undefined);
                break;
            case 'boolean':
                cov = share(s => parseAs('boolean', s) !== undefined);
                break;
            default:
                cov = 0;
        }
        if (cov >= MIN_COVERAGE) {
            if (type === 'money') {
                const counts = new Map<string, number>();
                strings.forEach(s => { const c = parseMoney(s)?.currency; if (c) counts.set(c, (counts.get(c) ?? 0) + 1); });
                const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
                return { type, coverage: cov, currency, label: currency ? `money (${currency})` : 'money' };
            }
            return { type, coverage: cov, label: type === 'integer' ? 'whole number' : type };
        }
    }
    return { type: 'text', coverage: 1, label: 'text' };
}
