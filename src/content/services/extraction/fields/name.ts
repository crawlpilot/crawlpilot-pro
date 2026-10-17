/** Stage 5: names from evidence, unique; the most-filled field gets the plain name. */
import type { ColumnType } from '../ExtractionTypes';
import { nodeStep } from '../nodeName';
import { Field, norm } from './types';

/** Words that describe layout, state or a framework, never what a value is. */
const NOISE_WORDS = new Set(['text', 'label', 'value', 'wrapper', 'wrap', 'container', 'inner', 'outer', 'content', 'item', 'items',
    'component', 'root', 'box', 'block', 'el', 'elem', 'element', 'span', 'div', 'col', 'row', 'cell', 'info', 'details', 'detail',
    'card', 'tile', 'module', 'section', 'main', 'body', 'link', 'txt', 'lbl', 'field', 'data', 'top', 'bottom', 'left', 'right',
    'recipe', 'instrumentation', 'declarative', 'offscreen', 'outline', 'rush', 'faceout', 'bold', 'weight', 'normal', 'base', 'spacing',
    'size', 'widget', 'grid', 'list', 'group', 'line', 'clamp', 'truncate', 'color', 'style', 'theme', 'variant', 'primary', 'secondary',
    'small', 'large', 'medium', 'mini', 'micro', 'default', 'heading', 'title', 'none', 'show', 'visible', 'display', 'layout', 'puis',
    'puisg', 'csa', 'sg', 'aok', 'js', 'ui', 'mod', 'cmp', 'comp', 'internal', 'external', 'holder', 'area', 'region']);
/** Short words that do name a value. */
const SHORT_WORDS = new Set(['sku', 'age', 'url', 'tag', 'fee', 'tax', 'qty', 'new', 'id', 'isbn', 'upc', 'ean', 'mpn', 'brand', 'size']);
const STRIKE_CLASS = /strike|line-?through|\bwas\b|was-?price|old|original|list-?price|compare|crossed|regular-?price|before|rrp|msrp/i;
const UNIT_PRICE = /\/\s*(oz|fl\s?oz|lb|kg|g|ml|l|ct|count|each|unit|item|100\s?g|sq\s?ft)\b|\bper\s+\w+/i;
const REVIEW_WORDS = /reviews?|ratings?/i;
const SALES_WORDS = /\b(bought|sold|purchased|orders?)\b/i;
const BRACKET_COUNT = /^\(?[\d.,]+\s*[kKmM]?\+?\)?$/;
const WAS_LABEL = /^(was|list|list price|reg(ular)?|orig(inal)?|compare at|before|msrp|rrp)\s*(price)?\s*:?$/i;
const WAS_BEFORE = /(was|list|reg(ular)?|orig(inal)?|compare at|before|msrp|rrp)\s*(price)?\s*:?\s*$/i;

export const HTML_TAGS = new Set(['a', 'abbr', 'article', 'aside', 'b', 'button', 'dd', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'i', 'img', 'label', 'li', 'main', 'nav', 'ol', 'p', 'picture', 'section', 'small',
    'span', 'strong', 'sub', 'sup', 'table', 'td', 'th', 'time', 'tr', 'u', 'ul']);

function titleCase(s: string): string {
    return s.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * A readable name from a class or test id, or "" when it names layout or a framework:
 * "product-card__brand-name" → "Brand Name", "title-differentiators" → "Differentiators",
 * "puis-bold-weight-text" → "".
 */
function tidyLabel(label: string): string {
    if (HTML_TAGS.has(label.replace(/\[.*$/, ''))) return '';
    const last = label.split(/__|--/).pop() || label;
    const words = last
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(/[-_\s.:]+/)
        .map(w => w.toLowerCase())
        .filter(w => w && !NOISE_WORDS.has(w) && !/\d/.test(w) && (w.length > 3 || SHORT_WORDS.has(w)) && /[aeiouy]/.test(w));
    return titleCase(words.join(' '));
}

/** The element's own schema/test attribute (a wrapper's would name every field inside it alike). */
function anchorName(f: Field): string {
    const el = f.atoms[0].el;
    for (const attr of ['itemprop', 'data-testid', 'data-cy']) {
        const v = el.getAttribute(attr);
        if (v) { const t = tidyLabel(v); if (t) return t; }
    }
    return '';
}

/** A name from the element's own class or its parent's; further up, a wrapper's class names a different thing. */
function className(f: Field): string {
    for (const el of [...f.atoms[0].path].reverse().slice(0, 2)) {
        const t = tidyLabel(nodeStep(el).label);
        if (t) return t;
    }
    return '';
}

/** Struck through (tag, class, `data-*strike*`, style) or labelled "List:" / "Was" just before it. */
function isStruck(f: Field): boolean {
    return f.atoms.slice(0, 5).some(a => WAS_LABEL.test((a.el.previousElementSibling?.textContent || '').trim()) || [a.el, ...a.path].some(el =>
        /^(S|DEL|STRIKE)$/.test(el.tagName) || STRIKE_CLASS.test(el.getAttribute('class') || '') ||
        Array.from(el.attributes).some(at => /strike/i.test(at.name) && at.value !== 'false') ||
        /line-through/.test((el as HTMLElement).style?.textDecoration || '') ||
        (el === a.el && /line-through/.test(getComputedStyle(el).textDecorationLine || ''))));
}

/** The value says "List: $X", or another field of the same row says "Was $X" about it. */
function labelledWas(f: Field, all: Field[]): boolean {
    let rows = 0;
    let was = 0;
    f.values.forEach((value, r) => {
        rows++;
        const v = norm(value);
        if (WAS_BEFORE.test(v.replace(/[\p{Sc}\d.,\s]+$/u, ''))) { was++; return; }
        if (all.some(o => {
            if (o === f) return false;
            const text = norm(o.values.get(r) || '');
            const i = text.indexOf(v);
            return i > 0 && WAS_BEFORE.test(text.slice(0, i));
        })) was++;
    });
    return rows > 0 && was / rows >= 0.6;
}

function inHeading(f: Field): boolean {
    return f.atoms.some(a => /^H[1-6]$/.test(a.el.tagName) || !!a.el.closest('h1,h2,h3,h4,h5,h6'));
}

/** A name from evidence, in order: what the value is (image, link, price, rating…), schema or test attributes, headings, the class. */
function baseName(f: Field, all: Field[]): string {
    const anchor = anchorName(f);
    const sample = [...f.values.values()].slice(0, 20);
    if (f.attr === 'src') return f.many ? 'Images' : 'Image';
    if (f.attr === 'href') return f.many ? 'Links' : 'URL';
    if (f.attr === 'datetime') return 'Date';
    switch (f.shape) {
        case 'price':
            if (sample.some(v => /deliver|shipping/i.test(v))) return 'Delivery Price';
            if (isStruck(f) || labelledWas(f, all)) return 'Was Price';
            if (sample.some(v => UNIT_PRICE.test(v))) return 'Unit Price';
            return 'Price';
        case 'rating': return 'Rating';
        case 'count':
            if (sample.some(v => SALES_WORDS.test(v))) return 'Sales Volume';
            if (sample.some(v => REVIEW_WORDS.test(v)) || sample.every(v => BRACKET_COUNT.test(v.trim()))) return 'Reviews';
            return anchor || className(f) || 'Count';
        case 'date': return 'Date';
    }
    if (sample.some(v => SALES_WORDS.test(v)) && sample.every(v => v.length < 60)) return 'Sales Volume';
    if (anchor) return anchor;
    if ((f.attr === 'text' || f.attr === 'own') && inHeading(f)) return 'Title';
    const tag = f.atoms[0].el.tagName;
    if (tag === 'DT' || tag === 'TH') return 'Label';
    if (tag === 'DD') return 'Value';
    const cls = className(f);
    if (cls) return cls;
    // Short labels drawn from a small vocabulary ("Top Brand", "Best Seller", "Deal").
    const distinct = new Set(sample.map(norm));
    if (!f.many && sample.length >= 2 && sample.every(v => v.length <= 30) && distinct.size <= Math.max(3, sample.length * 0.4)) return 'Badge';
    return f.many ? 'Details' : 'Text';
}

export function columnType(f: Field): ColumnType {
    if (f.attr === 'src') return f.many ? 'image_array' : 'image';
    if (f.attr === 'href') return f.many ? 'link_array' : 'url';
    switch (f.shape) {
        case 'price': return 'price';
        case 'rating': case 'count': case 'number': return 'number';
        case 'date': return 'date';
        default: return f.many ? 'text_array' : 'text';
    }
}

/** A unique name per field, in the fields' order (best first). */
export function nameFields(fields: Field[]): string[] {
    const used = new Set<string>();
    return fields.map(f => {
        let name = baseName(f, fields);
        if (used.has(name)) {
            const hint = className(f);
            if (hint && hint !== name && !used.has(`${name} (${hint})`)) name = `${name} (${hint})`;
        }
        let i = 2;
        const base = name;
        while (used.has(name)) name = `${base} ${i++}`;
        used.add(name);
        return name;
    });
}
