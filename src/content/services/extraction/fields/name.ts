/** Stage 5: names from evidence, unique; the most-filled field gets the plain name. */
import type { ColumnType } from '../../../../shared/types/database';
import { nodeStep } from '../nodeName';
import { AUTHOR_ATTRIBUTES } from '../../../../shared/selectors/stability';
import { meaningOf, typeOfMeaning } from './meaning';
import { Field, norm } from './types';

/** Words that describe layout, state or a framework, never what a value is. */
const NOISE_WORDS = new Set(['text', 'label', 'value', 'wrapper', 'wrap', 'container', 'inner', 'outer', 'content', 'item', 'items',
    'component', 'root', 'box', 'block', 'el', 'elem', 'element', 'span', 'div', 'col', 'row', 'cell', 'info', 'details', 'detail',
    'card', 'tile', 'module', 'section', 'main', 'body', 'link', 'txt', 'lbl', 'field', 'data', 'top', 'bottom', 'left', 'right',
    'recipe', 'instrumentation', 'declarative', 'offscreen', 'outline', 'rush', 'faceout', 'bold', 'weight', 'normal', 'base', 'spacing',
    'size', 'widget', 'grid', 'list', 'group', 'line', 'clamp', 'truncate', 'color', 'style', 'theme', 'variant', 'primary', 'secondary',
    'small', 'large', 'medium', 'mini', 'micro', 'default', 'heading', 'title', 'none', 'show', 'visible', 'display', 'layout', 'puis',
    'puisg', 'csa', 'sg', 'aok', 'js', 'ui', 'mod', 'cmp', 'comp', 'internal', 'external', 'holder', 'area', 'region', 'nowrap', 'wrapper',
    'background', 'platinum', 'align', 'children', 'center', 'column', 'columns', 'flex', 'inline', 'cut', 'attribute', 'attr', 'pod', 'hidden', 'shown', 'active', 'selected', 'dynamic']);
/** Short words that do name a value. */
const SHORT_WORDS = new Set(['sku', 'age', 'url', 'tag', 'fee', 'tax', 'qty', 'new', 'id', 'isbn', 'upc', 'ean', 'mpn', 'brand', 'size']);
/** Struck-through price classes, as whole class words (`font-bold` is not "old"). */
const STRIKE_CLASS = /(^|[\s_-])(strike|strikethrough|line-?through|was|was-?price|old|old-?price|original|list-?price|compare|compare-?at|crossed|regular-?price|before|rrp|msrp)($|[\s_-])/i;
const UNIT_PRICE = /\/\s*(oz|fl\s?oz|lb|kg|g|ml|l|ct|count|each|unit|item|100\s?g|sq\s?ft)\b|\bper\s+\w+/i;
const REVIEW_WORDS = /reviews?|ratings?/i;
const SALES_WORDS = /\b(bought|sold|purchased|orders?)\b/i;
const LIMIT_WORDS = /\blimit(ed)?\b.*\bper\b|\bmax(imum)?\b.*\bper\b/i;
const DELIVERY_WORDS = /\b(deliver(y|ed|s)?|shipping|ships|arrives)\b/i;
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

/**
 * The element's own author attribute (a wrapper's would name every field inside it alike). A hook
 * ending in "title" (`product-title`, `itemTitle`) names the title.
 */
function anchorName(f: Field): string {
    const el = f.atoms[0].el;
    for (const attr of AUTHOR_ATTRIBUTES) {
        const v = el.getAttribute(attr);
        if (!v) continue;
        if (/(^|[-_\s.]|[a-z])title$/i.test(v)) return 'Title';
        const t = tidyLabel(v);
        if (t) return meaningOf(t, f.shape) ?? t;
    }
    return '';
}

/** A name from the element's own class or its parent's; further up, a wrapper's class names a different thing. */
function className(f: Field): string {
    for (const el of [...f.atoms[0].path].reverse().slice(0, 2)) {
        const t = tidyLabel(nodeStep(el).label);
        if (t) return meaningOf(t, f.shape) ?? t;
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

const ACRONYMS = new Set(['id', 'sku', 'asin', 'upc', 'ean', 'gtin', 'mpn', 'pid']);

function attributeName(attr: string): string {
    return attr.replace(/^data-/, '').split(/[-_]/).filter(Boolean)
        .map(w => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
}

/** A name from evidence, in order: what the value is (image, link, price, rating…), schema or test attributes, headings, the class. */
function baseName(f: Field, all: Field[]): string {
    const anchor = anchorName(f);
    const sample = [...f.values.values()].slice(0, 20);
    if (f.attr === 'src') return f.many ? 'Images' : 'Image';
    if (f.attr === 'href') return f.many ? 'Links' : 'URL';
    if (f.attr === 'datetime') return 'Date';
    // A value attribute is named by its own name: `data-product-id` → Product ID, `data-asin` → ASIN.
    if (f.attr.startsWith('data-')) return attributeName(f.attr);
    // A component kind is named by its own words: "Pickup today" is pickup, not a date.
    if (f.label) return f.label;
    switch (f.shape) {
        case 'price':
            if (sample.some(v => /deliver|shipping/i.test(v))) return 'Delivery Price';
            if (isStruck(f) || labelledWas(f, all)) return 'Was Price';
            if (sample.some(v => UNIT_PRICE.test(v))) return 'Unit Price';
            return 'Price';
        case 'rating': return 'Rating';
        case 'count':
            if (sample.some(v => LIMIT_WORDS.test(v))) return 'Purchase Limit';
            if (sample.some(v => SALES_WORDS.test(v))) return 'Sales Volume';
            if (sample.some(v => REVIEW_WORDS.test(v)) || sample.every(v => BRACKET_COUNT.test(v.trim()))) return 'Review Count';
            return anchor || className(f) || 'Count';
        case 'date': return 'Date';
    }
    if (sample.some(v => LIMIT_WORDS.test(v)) && sample.every(v => v.length < 60)) return 'Purchase Limit';
    if (sample.some(v => SALES_WORDS.test(v)) && sample.every(v => v.length < 60)) return 'Sales Volume';
    if (!f.many && sample.length > 0 && sample.every(v => DELIVERY_WORDS.test(v) && v.length < 80)) return 'Delivery';
    if (anchor) return anchor;
    if ((f.attr === 'text' || f.attr === 'own') && inHeading(f)) return 'Title';
    // A card's main link text with no heading or hook naming it ("Trail runner") is its title.
    if (f.attr === 'text' && f.atoms[0].el.closest('a') && !all.some(o => o !== f && inHeading(o))) return 'Title';
    const tag = f.atoms[0].el.tagName;
    if (tag === 'DT' || tag === 'TH') return 'Label';
    if (tag === 'DD') return 'Value';
    const cls = className(f);
    if (cls) return cls;
    // Short labels drawn from a small vocabulary ("Top Brand", "Best Seller", "Deal").
    const distinct = new Set(sample.map(norm));
    if (!f.many && sample.length >= 2 && sample.every(v => v.length <= 30) && distinct.size <= Math.max(3, sample.length * 0.4)) return 'Badge';
    // A list of short labels (colours, sizes, styles a card offers).
    if (f.many && sample.length > 0 && sample.every(v => v.split('; ').every(x => x.length <= 30))) return 'Options';
    return f.many ? 'Details' : 'Text';
}

/** The column type: a list, an image or a link by what is read, else by the field's meaning, else by its values. */
export function columnType(f: Field, name = ''): ColumnType {
    if (f.attr === 'src') return f.many ? 'image_array' : 'image';
    if (f.attr === 'href') return f.many ? 'link_array' : 'url';
    if (f.all || f.many) return 'text_array';
    const typed = typeOfMeaning(name);
    if (typed) return typed;
    switch (f.shape) {
        case 'price': return 'price';
        case 'rating': case 'count': case 'number': return 'number';
        case 'date': return 'date';
        default: return 'text';
    }
}

/** Each field's name from evidence; several fields may share one (`refineFields` joins or tells them apart). */
export function baseNames(fields: Field[]): string[] {
    const names = fields.map(f => baseName(f, fields));
    // One title: the card's main text, the most filled and then longest of the fields named so.
    const titles = fields.map((f, i) => ({ f, i })).filter(x => names[x.i] === 'Title');
    if (titles.length > 1) {
        const avg = (f: Field) => [...f.values.values()].reduce((n, v) => n + v.length, 0) / Math.max(1, f.values.size);
        const best = titles.sort((a, b) => b.f.values.size - a.f.values.size || avg(b.f) - avg(a.f))[0];
        titles.forEach(x => { if (x !== best) names[x.i] = 'Text'; });
    }
    return names;
}

/** A unique name per field, in the fields' order (best first): the first keeps the plain name. */
export function uniqueNames(fields: Field[], bases: string[]): string[] {
    const used = new Set<string>();
    return fields.map((f, k) => {
        let name = bases[k];
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
