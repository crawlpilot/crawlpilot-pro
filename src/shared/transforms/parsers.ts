/**
 * Value parsers for scraped text: money with currency, locale-aware numbers, counts ("10K+"),
 * percentages, ratings, dates (absolute and relative), URLs (absolute, tracking stripped), booleans.
 * Ideas from thenos recipes/transforms (money, numbers, dates, units, urls). All pure.
 */
import { parseNumberish } from '../network/jsonSearch';

export { parseNumberish as parseNumber };

export interface Money {
    amount: number;
    currency: string | null;
    /** Top of a range ("$10 – $20"). */
    upper?: number;
}

const SYMBOLS: [RegExp, string][] = [
    [/US\$|\$US/i, 'USD'], [/CA\$|C\$/i, 'CAD'], [/AU\$|A\$/i, 'AUD'], [/NZ\$/i, 'NZD'], [/HK\$/i, 'HKD'], [/S\$/i, 'SGD'], [/R\$/i, 'BRL'], [/MX\$/i, 'MXN'],
    [/€/, 'EUR'], [/£/, 'GBP'], [/¥|￥|円/, 'JPY'], [/₹|Rs\.?(?=\s?\d)/i, 'INR'], [/₩/, 'KRW'], [/₽/, 'RUB'], [/₺/, 'TRY'], [/₪/, 'ILS'], [/₫/, 'VND'], [/₱/, 'PHP'], [/฿/, 'THB'], [/zł/i, 'PLN'], [/kr\b/i, 'SEK'], [/CHF/i, 'CHF'],
    [/\$/, 'USD'],
];
const CODES = /\b(USD|EUR|GBP|JPY|INR|CAD|AUD|NZD|CHF|CNY|RMB|SEK|NOK|DKK|PLN|BRL|MXN|KRW|RUB|TRY|ZAR|SGD|HKD|AED|SAR|ILS|THB|VND|PHP|IDR|MYR)\b/i;

function currencyOf(s: string): string | null {
    const code = CODES.exec(s)?.[1]?.toUpperCase();
    if (code) return code === 'RMB' ? 'CNY' : code;
    for (const [re, cur] of SYMBOLS) if (re.test(s)) return cur;
    return null;
}

/** "$1,299.99", "1.299,00 €", "From £20 – £35", "USD 15" → Money; null when there is no amount. */
export function parseMoney(raw: unknown): Money | null {
    if (typeof raw === 'number') return { amount: raw, currency: null };
    if (typeof raw !== 'string') return null;
    const s = raw.replace(/ /g, ' ').trim();
    if (!s) return null;
    const nums = s.match(/\d[\d.,\s]*\d|\d/g)?.map(n => parseNumberish(n.replace(/\s(?=\d{3}\b)/g, ''))).filter((n): n is number => n !== undefined);
    if (!nums || nums.length === 0) return null;
    const currency = currencyOf(s);
    const isRange = nums.length >= 2 && /[-–—]|\bto\b/i.test(s);
    if (nums.length > 1 && !isRange) {
        // "Was $59.99 Now $44.99" style: take the first, which is usually the displayed price;
        // callers with a list price use their own column.
        return { amount: nums[0], currency };
    }
    return isRange ? { amount: nums[0], currency, upper: nums[1] } : { amount: nums[0], currency };
}

/** "10K+", "1.2M", "3,456 ratings", "2.5k bought" → number. */
export function parseCount(raw: unknown): number | undefined {
    if (typeof raw === 'number') return raw;
    if (typeof raw !== 'string') return undefined;
    const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kKmMbB])?\b/);
    if (!m) return undefined;
    const n = parseFloat(m[1]);
    const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1;
    return Math.round(n * mult);
}

/** "15%", "15 % off" → 15. */
export function parsePercent(raw: unknown): number | undefined {
    if (typeof raw === 'number') return raw;
    if (typeof raw !== 'string' || !raw.includes('%')) return undefined;
    const m = raw.match(/-?\d+(?:[.,]\d+)?(?=\s*%)/);
    return m ? parseFloat(m[0].replace(',', '.')) : undefined;
}

/** "4.5 out of 5 stars", "4,5/5", "Rated 4.2" → 4.5 (scaled to 5 when the scale is given). */
export function parseRating(raw: unknown): number | undefined {
    if (typeof raw === 'number') return raw >= 0 && raw <= 5 ? raw : undefined;
    if (typeof raw !== 'string') return undefined;
    const s = raw.replace(',', '.');
    const scaled = s.match(/(\d+(?:\.\d+)?)\s*(?:\/|out of|of)\s*(\d+)/i);
    if (scaled) {
        const v = parseFloat(scaled[1]);
        const scale = parseFloat(scaled[2]);
        if (scale > 0 && v <= scale) return Math.round((v / scale) * 5 * 100) / 100;
    }
    const m = s.match(/\b([0-5](?:\.\d+)?)\b/);
    if (!m) return undefined;
    const v = parseFloat(m[1]);
    return v >= 0 && v <= 5 ? v : undefined;
}

const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
    january: 0, february: 1, march: 2, april: 3, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function iso(y: number, m: number, d: number): string | undefined {
    const dt = new Date(Date.UTC(y, m, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return undefined;
    return dt.toISOString().slice(0, 10);
}

/**
 * Dates to ISO (YYYY-MM-DD; with time when given in ISO form). Handles ISO, "Jan 5, 2024",
 * "5 January 2024", "2024/01/05", "05/01/2024" (day-first when the first part > 12, else month-first
 * unless `dayFirst`), and relative "3 days ago", "yesterday", "2 hours ago".
 */
export function parseDate(raw: unknown, opts: { now?: Date; dayFirst?: boolean } = {}): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const s = raw.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
    if (!s) return undefined;
    const now = opts.now ?? new Date();

    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
        const date = iso(+m[1], +m[2] - 1, +m[3]);
        if (!date) return undefined;
        return m[4] ? `${date}T${m[4]}:${m[5]}:${m[6] ?? '00'}` : date;
    }
    m = s.match(/\b(\d{4})[/.](\d{1,2})[/.](\d{1,2})\b/);
    if (m) return iso(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
    if (m) {
        let a = +m[1], b = +m[2];
        let y = +m[3];
        if (y < 100) y += 2000;
        const dayFirst = a > 12 || (opts.dayFirst && b <= 12);
        if (dayFirst) [a, b] = [b, a];
        return iso(y, a - 1, b);
    }
    m = s.match(/\b([a-z]{3,9})\.? (\d{1,2}) (\d{4})\b/);
    if (m && MONTHS[m[1]] !== undefined) return iso(+m[3], MONTHS[m[1]], +m[2]);
    m = s.match(/\b(\d{1,2}) ([a-z]{3,9})\.? (\d{4})\b/);
    if (m && MONTHS[m[2]] !== undefined) return iso(+m[3], MONTHS[m[2]], +m[1]);
    m = s.match(/\b([a-z]{3,9}) (\d{4})\b/);
    if (m && MONTHS[m[1]] !== undefined) return iso(+m[2], MONTHS[m[1]], 1);

    const day = (offset: number) => {
        const d = new Date(now.getTime() - offset);
        return d.toISOString().slice(0, 10);
    };
    if (/\btoday\b|\bjust now\b/.test(s)) return day(0);
    if (/\byesterday\b/.test(s)) return day(864e5);
    m = s.match(/\b(\d+|an?|one)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/);
    if (m) {
        const n = /^\d+$/.test(m[1]) ? +m[1] : 1;
        const unit = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 }[m[2] as 'day'];
        return day(n * unit);
    }
    return undefined;
}

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_[a-z]+|_hsenc|_hsmi|ref|ref_|tag|spm|scm|igshid|yclid|_ga|pd_rd_[a-z]+|pf_rd_[a-z]+|qid|sr|crid|sprefix|psc|th)$/i;

/** Absolute URL with tracking parameters removed; undefined when it isn't a URL. */
export function cleanUrl(raw: unknown, base?: string, opts: { stripTracking?: boolean } = {}): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const s = raw.trim();
    if (!s || /^(javascript|mailto|tel|data):/i.test(s)) return undefined;
    try {
        const u = new URL(s, base);
        if (!/^https?:$/.test(u.protocol)) return undefined;
        if (opts.stripTracking !== false) {
            Array.from(u.searchParams.keys()).forEach(k => { if (TRACKING.test(k)) u.searchParams.delete(k); });
        }
        u.hash = '';
        return u.toString();
    } catch {
        return undefined;
    }
}

const TRUE = /^(yes|true|y|1|in stock|available|on|✓|✔|checked)$/i;
const FALSE = /^(no|false|n|0|out of stock|unavailable|sold out|off|✗|✘)$/i;

export function parseBoolean(raw: unknown): boolean | undefined {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw !== 'string') return undefined;
    const s = raw.trim();
    if (TRUE.test(s)) return true;
    if (FALSE.test(s)) return false;
    return undefined;
}
