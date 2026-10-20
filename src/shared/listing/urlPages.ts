/**
 * Numbered pages by their address (docs/plans/product-improvements-plan.md §5, S4): when the Next link
 * differs from this page's address by one number (`?page=2`, `/page/2/`, `offset=24`, `-p2`), every
 * page's address is known. The pages can then be read without clicking: in background tabs, several
 * at once, still working when the Next button changes.
 */

export interface UrlPages {
    /** The address with `{n}` where the page number (or offset) goes. */
    template: string;
    /** The value on page 2, and how much it grows per page (1 for page numbers, 24 for an offset of 24). */
    second: number;
    step: number;
    /** Page 1 as it was (it may have no number at all: `/shoes` before `/shoes?page=2`). */
    first: string;
}

/** The `{n}` the URL API encoded, back as the placeholder (and nothing else decoded). */
const placeholder = (href: string) => href.replace(/%7Bn%7D/gi, '{n}');

const OFFSET_KEY = /^(offset|start|from|skip|o|s|first|startindex|start_index|begin)$/i;

function normal(u: URL): string {
    const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}${query}`;
}

/** Page 1 without the number: the query parameter dropped, or the path's `/page/2` / `/2` tail removed. */
function withoutNumber(next: URL, at: { param?: string; pathTail?: number }): string | null {
    const u = new URL(next.href);
    if (at.param) { u.searchParams.delete(at.param); return normal(u); }
    if (at.pathTail) {
        const segments = u.pathname.split('/').filter(Boolean);
        u.pathname = `/${segments.slice(0, segments.length - at.pathTail).join('/')}`;
        return normal(u);
    }
    return null;
}

/**
 * The numbered-page pattern between this page and its Next link, or null when they don't differ by
 * exactly one number (a cursor, a token, a different path).
 */
export function urlPages(current: string, nextHref: string): UrlPages | null {
    let cur: URL, next: URL;
    try { cur = new URL(current); next = new URL(nextHref, current); } catch { return null; }
    if (cur.origin !== next.origin) return null;
    const curKey = normal(cur);
    const found: UrlPages[] = [];

    // Query parameters: one numeric value differs, or is only on the next page.
    for (const [key, value] of next.searchParams) {
        if (!/^\d+$/.test(value)) continue;
        const v2 = Number(value);
        const t = new URL(next.href);
        t.searchParams.set(key, '{n}');
        const curValue = cur.searchParams.get(key);
        const rest = (u: URL) => { const c = new URL(u.href); c.searchParams.delete(key); return normal(c); };
        if (rest(cur) !== rest(next)) continue;
        if (curValue !== null && /^\d+$/.test(curValue)) {
            const step = v2 - Number(curValue);
            if (step > 0) found.push({ template: placeholder(t.href), second: v2, step, first: current });
        } else if (curValue === null && withoutNumber(next, { param: key }) === curKey) {
            // Page 1 has no number: an offset starts at 0, a page number at 1.
            const step = OFFSET_KEY.test(key) ? v2 : v2 - 1;
            if (step > 0) found.push({ template: placeholder(t.href), second: v2, step, first: current });
        }
    }

    // The path: one segment's number differs (`/page/2`, `/p-2`, `/shoes-page2`), or a numbered tail is added.
    const cs = cur.pathname.split('/').filter(Boolean);
    const ns = next.pathname.split('/').filter(Boolean);
    const sameQuery = normal(new URL(`${cur.origin}/?${cur.searchParams}`)) === normal(new URL(`${next.origin}/?${next.searchParams}`));
    if (sameQuery && cs.length === ns.length) {
        const diff = ns.map((s, i) => (s !== cs[i] ? i : -1)).filter(i => i >= 0);
        if (diff.length === 1) {
            const i = diff[0];
            const a = /(\d+)/g, b = /(\d+)/g;
            const curNums = [...cs[i].matchAll(a)], nextNums = [...ns[i].matchAll(b)];
            if (curNums.length === nextNums.length && curNums.length > 0) {
                const changed = nextNums.map((m, k) => (m[1] !== curNums[k][1] ? k : -1)).filter(k => k >= 0);
                if (changed.length === 1 && cs[i].replace(/\d+/g, '#') === ns[i].replace(/\d+/g, '#')) {
                    const k = changed[0];
                    const v1 = Number(curNums[k][1]), v2 = Number(nextNums[k][1]);
                    const m = nextNums[k];
                    const seg = `${ns[i].slice(0, m.index!)}{n}${ns[i].slice(m.index! + m[1].length)}`;
                    const t = new URL(next.href);
                    t.pathname = `/${[...ns.slice(0, i), seg, ...ns.slice(i + 1)].join('/')}${next.pathname.endsWith('/') ? '/' : ''}`;
                    if (v2 > v1) found.push({ template: placeholder(t.href), second: v2, step: v2 - v1, first: current });
                }
            }
        }
    } else if (sameQuery && ns.length > cs.length && ns.length - cs.length <= 2 && cs.every((s, i) => s === ns[i])) {
        // `/shoes` → `/shoes/page/2` or `/shoes/2`: the tail is a number, maybe after a word.
        const tail = ns.slice(cs.length);
        const last = tail[tail.length - 1];
        if (/^\d+$/.test(last) && (tail.length === 1 || /^[a-z]+$/i.test(tail[0]))) {
            const v2 = Number(last);
            const t = new URL(next.href);
            t.pathname = `/${[...ns.slice(0, -1), '{n}'].join('/')}${next.pathname.endsWith('/') ? '/' : ''}`;
            if (v2 > 1) found.push({ template: placeholder(t.href), second: v2, step: v2 - 1, first: current });
        }
    }
    return found.length === 1 ? found[0] : null;
}

/** Page `k`'s address (`k` ≥ 1: page 1 is the address it was found on). */
export function pageAddress(p: UrlPages, k: number): string {
    if (k <= 1) return p.first;
    return p.template.replace('{n}', String(p.second + (k - 2) * p.step));
}

/** The addresses of pages 1 to `count`. */
export function pageAddresses(p: UrlPages, count: number): string[] {
    return Array.from({ length: Math.max(1, count) }, (_, i) => pageAddress(p, i + 1));
}
