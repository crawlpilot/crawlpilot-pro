/**
 * Stage 4b: the item's own link when no `<a href>` in the card gives it. Cards in single-page apps
 * often open their item by script (a `role="button"` card that sets `?currentJobId=…`) and carry no
 * link at all, or the card is wrapped in the link instead of holding one. Two ways to find it,
 * without site knowledge:
 *
 * - **Around:** the row sits inside its own `<a href>` (one link per row).
 * - **By ID:** the page's URL names the item that is open (`currentJobId=4456918528`, `/item/4456918528`),
 *   and that ID is in an attribute of one row (`data-job-id="4456918528"`, `componentkey="job-4456918528"`).
 *   Every row has its own ID in the same attribute, so each row's link is the page's own link to the
 *   open item (`/jobs/view/4456918528/` in a detail pane) with the row's ID in its place, else the
 *   page URL with it: the URL that opens it.
 */
import { readValue } from '../atoms';
import { Field, query } from './types';

export type LinkSpec =
    | { from: 'around' }
    | { from: 'id'; selector: string; attr: string; pattern: string; template: string };

const MIN_SHARE = 0.6;
const MAX_ELEMENTS = 400;
const PLACEHOLDER = '{id}';
/** Attributes that never hold the item's ID, or are links read elsewhere. */
const NOT_ID = new Set(['class', 'style', 'src', 'srcset', 'href', 'alt', 'width', 'height', 'd', 'viewBox']);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Literal text with its numbers free: the rest of `job-card-4456918528-v2` around the ID. */
const loose = (s: string) => escape(s).replace(/\d+/g, '\\d+');

/** IDs the page URL names: query values and path segments with a digit, and where each sits. */
function urlIds(page: URL): { id: string; template: string }[] {
    const out: { id: string; template: string }[] = [];
    const isId = (v: string) => v.length >= 4 && v.length <= 40 && /\d/.test(v) && /^[\w-]+$/.test(v);
    // The query as written, so the link keeps the page's other parameters exactly (`%20` stays `%20`).
    const pairs = page.search.slice(1).split('&');
    pairs.forEach((pair, i) => {
        const eq = pair.indexOf('=');
        if (eq < 0 || !isId(pair.slice(eq + 1))) return;
        const search = pairs.map((p, j) => (j === i ? `${pair.slice(0, eq)}=${PLACEHOLDER}` : p)).join('&');
        out.push({ id: pair.slice(eq + 1), template: `${page.origin}${page.pathname}?${search}${page.hash}` });
    });
    const segments = page.pathname.split('/');
    segments.forEach((seg, i) => {
        if (!isId(seg)) return;
        const u = new URL(page.href);
        u.pathname = segments.map((s, j) => (j === i ? PLACEHOLDER : s)).join('/');
        out.push({ id: seg, template: u.href.replace(encodeURIComponent(PLACEHOLDER), PLACEHOLDER) });
    });
    return out;
}

/**
 * The row-relative selector of `el` for reading `attr`: the row itself, else the first element with
 * the attribute, else with the attribute starting as `el`'s does (`[componentkey^="job-card-component-ref-"]`
 * among other `componentkey`s).
 */
function selectorOf(el: Element, attr: string, prefix: string, row: Element): string | null {
    if (el === row) return ':scope';
    const name = CSS.escape(attr);
    const lead = prefix.replace(/\d+$/, '');
    for (const sel of [`[${name}]`, ...(lead ? [`[${name}^="${lead.replace(/["\\]/g, '\\$&')}"]`] : [])]) {
        if (query(row, sel)[0] === el) return sel;
    }
    return null;
}

export function readLink(row: Element, spec: LinkSpec): string | undefined {
    if (spec.from === 'around') {
        const a = row.parentElement?.closest('a[href]');
        return a ? readValue(a, 'href') || undefined : undefined;
    }
    const el = query(row, spec.selector)[0];
    const m = el ? new RegExp(spec.pattern).exec(el.getAttribute(spec.attr) || '') : null;
    return m ? spec.template.replace(PLACEHOLDER, encodeURIComponent(m[1])) : undefined;
}

function fieldOf(rows: Element[], spec: LinkSpec, selector: string): Field | null {
    const values = new Map<number, string>();
    rows.forEach((row, r) => { const v = readLink(row, spec); if (v) values.set(r, v); });
    // Each row its own link, in most rows.
    if (values.size < Math.max(2, rows.length * MIN_SHARE) || new Set(values.values()).size < values.size) return null;
    return {
        key: `link:${spec.from}`, attr: 'href', selector, values, shape: 'url', order: -1, link: spec,
        atoms: [...values.entries()].map(([r, value]) => ({ el: rows[r], attr: 'href' as const, value, sig: `link:${spec.from}`, path: [] })),
    };
}

/**
 * The page's own link to the open item, as a template: a link elsewhere on the page with the ID as a
 * path segment (the detail pane's `/jobs/view/4478228390/?trackingId=…` → `/jobs/view/{id}/`), its
 * query (tracking) dropped. Better than the page URL, which keeps the search.
 */
function pageLinkTemplate(id: string, rows: Element[]): string | undefined {
    for (const a of Array.from(document.querySelectorAll('a[href]')).slice(0, 2000)) {
        if (rows.some(r => r.contains(a))) continue;
        let u: URL;
        try { u = new URL(readValue(a, 'href')); } catch { continue; }
        const segments = u.pathname.split('/');
        const i = segments.indexOf(id);
        if (i < 0) continue;
        return `${u.origin}${segments.map((s, j) => (j === i ? PLACEHOLDER : s)).join('/')}`;
    }
    return undefined;
}

function byId(rows: Element[], page: URL): Field | null {
    for (const { id, template: pageTemplate } of urlIds(page)) {
        const template = pageLinkTemplate(id, rows) ?? pageTemplate;
        const token = new RegExp(`(^|[^\\w])${escape(id)}([^\\w]|$)`);
        for (const row of rows) {
            const els = [row, ...Array.from(row.querySelectorAll('*')).slice(0, MAX_ELEMENTS)];
            for (const el of els) {
                for (const attr of el.getAttributeNames()) {
                    if (NOT_ID.has(attr)) continue;
                    const value = el.getAttribute(attr) || '';
                    const at = value.indexOf(id);
                    if (at < 0 || !token.test(value)) continue;
                    const selector = selectorOf(el, attr, value.slice(0, at), row);
                    if (!selector) continue;
                    const pattern = `^${loose(value.slice(0, at))}(${/^\d+$/.test(id) ? '\\d+' : '[\\w-]+'})${loose(value.slice(at + id.length))}$`;
                    const f = fieldOf(rows, { from: 'id', selector, attr, pattern, template }, selector);
                    if (f) return f;
                }
            }
        }
    }
    return null;
}

/**
 * The item link field, when the fields have none: from a link around the row, else from the ID the
 * page URL names. An ID route is also added when the card's links are to something else (the
 * company, the seller): none of them holds the row's ID.
 */
export function itemLinkField(rows: Element[], fields: Field[], page: URL = new URL(location.href)): Field | null {
    const links = fields.filter(f => f.attr === 'href' && !f.many);
    const hasItemLink = links.some(f => f.values.size >= rows.length * 0.5);
    if (!hasItemLink) {
        const around = fieldOf(rows, { from: 'around' }, ':scope');
        if (around) return around;
    }
    const id = byId(rows, page);
    if (!id) return null;
    // The ID route repeats a link the card has (`/jobs/view/4456918528`): not needed.
    const ids = new Map([...id.values.entries()].map(([r, v]) => [r, new URL(v).href]));
    const spec = id.link as Extract<LinkSpec, { from: 'id' }>;
    const rowId = (r: number) => new RegExp(spec.pattern).exec(query(rows[r], spec.selector)[0]?.getAttribute(spec.attr) || '')?.[1];
    const covered = links.some(f => [...ids.keys()].filter(r => { const v = f.values.get(r); const x = rowId(r); return !!v && !!x && v.includes(x); }).length >= ids.size * 0.8);
    return covered ? null : id;
}
