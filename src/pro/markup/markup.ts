/**
 * Fields read from the page's markup (`docs/plans/pro-data-collection-plan.md`, C8): meta tags (Open Graph `og:*`,
 * `product:price:amount`, Twitter cards) and microdata (`itemtype` + `itemprop`, nested props by path such as
 * `offers.price`). Sites put these there for search engines and link previews, so they rarely change with a
 * redesign: the steadiest way a field can have. Older retail sites often mark products up only this way.
 * Plain DOM code: bundled into the worker's in-page script and Pro's step script.
 */
import { microdataItem } from '../../shared/ai/structured';
import type { MarkupWay } from '../recipe/types';

/** Values longer than this are cut when listed for the editor. */
const LIST_VALUE_MAX = 200;
const IGNORED_META = /^(viewport|theme-color|color-scheme|format-detection|referrer|robots|google-site-verification|msapplication-.*|apple-.*)$/i;

const metaValue = (key: string): string | undefined => {
    for (const m of Array.from(document.querySelectorAll('meta[property], meta[name], meta[itemprop]'))) {
        const k = m.getAttribute('property') ?? m.getAttribute('name') ?? m.getAttribute('itemprop');
        if (k === key) {
            const v = (m.getAttribute('content') ?? '').trim();
            if (v) return v;
        }
    }
    return undefined;
};

const typeOf = (el: Element) => (el.getAttribute('itemtype') ?? '').split(/[\s/#]/).filter(Boolean).pop() ?? '';

/** Every microdata item on the page (nested ones too), as objects of their props. */
function microdataItems(): Record<string, any>[] {
    return Array.from(document.querySelectorAll('[itemscope]')).map(el => ({ ...microdataItem(el), '@type': typeOf(el) }));
}

const follow = (o: unknown, path: string[]): unknown => path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);

/** A markup way's value on this page, or undefined. */
export function readMarkup(way: Pick<MarkupWay, 'source' | 'key' | 'type'>): string | undefined {
    if (way.source === 'meta') return metaValue(way.key);
    const want = way.type?.toLowerCase();
    for (const item of microdataItems()) {
        if (want && String(item['@type']).toLowerCase() !== want) continue;
        const v = follow(item, way.key.split('.'));
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (typeof v === 'number') return String(v);
    }
    return undefined;
}

/** For each field, its first markup way that reads on this page: the value and which way. */
export function readMarkupFields(fields: { id: string; ways: Pick<MarkupWay, 'source' | 'key' | 'type'>[] }[]): Record<string, { value: string; used: number; matches: boolean[] }> {
    const out: Record<string, { value: string; used: number; matches: boolean[] }> = {};
    for (const f of fields) {
        const values = f.ways.map(readMarkup);
        const used = values.findIndex(v => v !== undefined);
        if (used >= 0) out[f.id] = { value: values[used]!, used, matches: values.map(v => v !== undefined) };
    }
    return out;
}

export interface MarkupEntry extends Pick<MarkupWay, 'source' | 'key' | 'type'> {
    value: string;
}

/** The markup on this page, as ways and their values: what the editor offers to read a field from. */
export function listMarkup(): MarkupEntry[] {
    const out: MarkupEntry[] = [];
    const seen = new Set<string>();
    for (const m of Array.from(document.querySelectorAll('meta[property], meta[name]'))) {
        const key = m.getAttribute('property') ?? m.getAttribute('name') ?? '';
        const value = (m.getAttribute('content') ?? '').trim();
        if (!key || !value || IGNORED_META.test(key) || seen.has(`meta|${key}`)) continue;
        seen.add(`meta|${key}`);
        out.push({ source: 'meta', key, value: value.slice(0, LIST_VALUE_MAX) });
    }
    const walk = (o: Record<string, any>, type: string, path: string[]) => {
        for (const [k, v] of Object.entries(o)) {
            if (k === '@type') continue;
            const p = [...path, k];
            if (v && typeof v === 'object') { if (p.length < 3) walk(v, type, p); continue; }
            const value = String(v ?? '').trim();
            const id = `microdata|${type}|${p.join('.')}`;
            if (!value || seen.has(id)) continue;
            seen.add(id);
            out.push({ source: 'microdata', key: p.join('.'), ...(type ? { type } : {}), value: value.slice(0, LIST_VALUE_MAX) });
        }
    };
    for (const item of microdataItems()) walk(item, String(item['@type'] ?? ''), []);
    return out;
}
