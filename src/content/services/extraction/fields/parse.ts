/**
 * Typed values (`docs/plans/generic-list-selectors-plan.md` §3.4): a column's type decides how its
 * values are written, the same on the preview, every page and every run.
 *
 *   number  "1,064" → "1064", "(27.9K)" → "27900", "4.4" → "4.4"
 *   price   "Now $629.00" → "$629.00", "Typical: $47.99" → "$47.99", "$199.00 – $299.00" → "$199.00"
 *           a price per unit keeps its unit: "($2.86/oz)" → "$2.86/oz", "£1.20 per kg" → "£1.20/kg"
 *
 * A value that doesn't hold what its type needs is kept as read.
 */
import type { ColumnType } from '../../../../shared/types/database';
import { onlyNumber } from './meaning';

/** An amount with its currency: "$1,299.99", "£20", "20,00 €", "USD 45". */
const MONEY = /[\p{Sc}]\s?\d[\d.,]*\d|[\p{Sc}]\s?\d|\d[\d.,]*\s?[\p{Sc}]|\b[A-Z]{3}\s?\d[\d.,]*\d/u;

/** A unit right after an amount: "/oz", "/ea", "/100 g", "/fl oz", " per kg". */
const PER_UNIT = /^\s*(?:\/|per\s+)\s*(\d*\s?\p{L}[\p{L}.]*(?:\s\p{L}{1,3}\b)?)/u;

/** The value holds what its type needs: one number, or an amount. */
export function parses(v: string, type: ColumnType): boolean {
    if (type === 'number') return onlyNumber(v) !== undefined;
    if (type === 'price') return MONEY.test(v);
    return true;
}

export function typedValue(v: string, type: ColumnType): string {
    if (type === 'number') {
        const x = onlyNumber(v);
        return x ? String(Math.round(x.n * 1e6) / 1e6) : v;
    }
    if (type === 'price') {
        const m = MONEY.exec(v);
        if (!m) return v;
        const amount = m[0].replace(/\s+/g, ' ').trim();
        // An amount for a unit is not the same value without it: "$2.86" per ounce is not "$2.86".
        const unit = PER_UNIT.exec(v.slice(m.index + m[0].length));
        return unit ? `${amount}/${unit[1].replace(/\s+/g, ' ').trim()}` : amount;
    }
    return v;
}
