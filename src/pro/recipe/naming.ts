/**
 * A name and an output type for each field picked on a page (`docs/plans/pro-ops-workflow-review.md`, findings 1
 * and 2): the picker names a field after its HTML tag (`h1`, `p`), so every field had to be renamed later. A field's
 * name is proposed from, in order:
 * - the page's data it is bound to (JSON-LD `name` → title, `offers.price` → price);
 * - the words in its selector (`.product-price`, `#sku`, `[itemprop="brand"]`);
 * - the shape of its value ("$79.00" → price, a date, a link or an image) or its tag (`h1` → title).
 * Names someone gave are kept; only placeholder names (a tag, empty) are proposed. Names stay unique in a recipe.
 */
import type { DataBinding } from '../../shared/types/database';
import type { FieldType } from './types';

/** What the picker gave a field: its name, how it reads (text, link, image), its selectors, its data, its value. */
export interface PickedField {
    name: string;
    type: string;
    selectors: string[];
    data?: DataBinding;
    shape?: string;
    value?: unknown;
}

export interface Proposal {
    name: string;
    type: FieldType;
    /** Where the name came from, for the person checking it. */
    why: string;
}

const TAGS = /^(h[1-6]|p|span|div|a|li|ul|ol|td|th|tr|img|picture|strong|b|em|i|small|section|article|label|button|dd|dt|dl|figure|figcaption|time|meta|link|header|footer|main|aside|nav|new element)$/i;

/** A name the picker made up (the tag), not one a person gave. */
export const isPlaceholderName = (name: string) => !name.trim() || TAGS.test(name.trim());

/** Words to names: the first that matches wins, so the more specific come first. */
const VOCAB: [RegExp, string][] = [
    [/(was|old|original|list|regular)[-_ ]?price|price[-_]+(was|old|original|regular)|compare[-_ ]?at|strike/i, 'was_price'],
    [/sale[-_ ]?price|now[-_ ]?price|special[-_ ]?price|current[-_ ]?price/i, 'price'],
    [/unit[-_ ]?price|price[-_ ]?per|per[-_ ]?unit/i, 'unit_price'],
    [/price[-_ ]?currency|currency/i, 'currency'],
    [/price|amount|cost/i, 'price'],
    [/discount|saving|percent[-_ ]?off/i, 'discount'],
    [/brand|manufacturer|vendor/i, 'brand'],
    [/\bsku\b|sku|item[-_ ]?number|article[-_ ]?number|product[-_ ]?code|model[-_ ]?number/i, 'sku'],
    [/gtin|ean|upc|barcode/i, 'gtin'],
    [/\bmpn\b/i, 'mpn'],
    [/rating[-_ ]?count|review[-_ ]?count|reviews?[-_ ]?total|num[-_ ]?reviews/i, 'review_count'],
    [/rating|stars|score/i, 'rating'],
    [/availability|in[-_ ]?stock|stock|inventory/i, 'availability'],
    [/delivery|shipping|fulfil/i, 'delivery'],
    [/breadcrumb/i, 'category'],
    [/categor/i, 'category'],
    [/colou?r/i, 'color'],
    [/\bsize/i, 'size'],
    [/descr|details|overview|summary/i, 'description'],
    [/image|photo|picture|thumbnail|gallery/i, 'image'],
    [/product[-_ ]?(title|name)|item[-_ ]?(title|name)|title|headline|\bname\b/i, 'title'],
];

/** A data path's last meaningful key, as the data names it (`offers.price` → price, `brand.name` → brand). */
function dataKey(b: DataBinding): string {
    const keys = [...b.path.filter((p): p is string => typeof p === 'string'), ...(b.key ? b.key.split(/[.[\]*]+/).filter(Boolean) : [])];
    const last = keys[keys.length - 1] ?? '';
    // `brand.name`, `seller.name`: the thing named, not "name".
    if (last === 'name' && keys.length > 1) return keys[keys.length - 2];
    return last;
}

const DATA_NAMES: Record<string, string> = {
    name: 'title', headline: 'title', price: 'price', lowprice: 'price', highprice: 'high_price', pricecurrency: 'currency',
    sku: 'sku', mpn: 'mpn', gtin: 'gtin', gtin13: 'gtin', gtin12: 'gtin', gtin14: 'gtin', gtin8: 'gtin', brand: 'brand',
    description: 'description', image: 'image', url: 'url', availability: 'availability', ratingvalue: 'rating',
    reviewcount: 'review_count', ratingcount: 'review_count', color: 'color', size: 'size', category: 'category',
    material: 'material', additionalproperty: 'specifications', productgroupid: 'product_group_id',
};

/** Words in a selector: classes, ids, attribute values. */
const selectorWords = (s: string) => (s.match(/[#.][\w-]+|\[[\w-]+=["']?[\w\s-]+["']?\]/g) ?? []).join(' ');

const PRICE_TEXT = /^[^\d]{0,4}\d[\d.,\s]*([^\d]{0,4})$/;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}|^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}\b/i;

/** The output type the value and reader suggest. */
function typeFor(f: PickedField, name: string): FieldType {
    if (f.data?.as === 'object') return 'object';
    if (f.data?.as === 'rows' || f.type === 'table' || f.type === 'list') return 'table';
    if (f.data?.as === 'list' || /_array$/.test(f.type)) return 'list';
    if (f.type === 'link' || f.type === 'image' || f.shape === 'url' || f.shape === 'image' || name === 'url' || name === 'image') return 'url';
    if (f.shape === 'price' || ['price', 'was_price', 'unit_price', 'high_price'].includes(name)) return 'money';
    if (name === 'rating') return 'number';
    if (name === 'review_count') return 'integer';
    if (f.shape === 'date' || (typeof f.value === 'string' && DATE_TEXT.test(f.value.trim()))) return 'date';
    return 'text';
}

function nameFor(f: PickedField): { name: string; why: string } {
    if (f.data) {
        const key = dataKey(f.data);
        const named = DATA_NAMES[key.toLowerCase()];
        if (named) return { name: named, why: `the page's data: ${key}` };
    }
    const words = f.selectors.map(selectorWords).join(' ');
    for (const [re, name] of VOCAB) if (re.test(words)) return { name, why: `its selector: ${f.selectors.find(s => re.test(selectorWords(s)))}` };
    const value = typeof f.value === 'string' ? f.value.trim() : '';
    if (f.shape === 'price' || (value && PRICE_TEXT.test(value) && /[$€£¥₹]|\b(usd|eur|gbp)\b/i.test(value))) return { name: 'price', why: `its value: ${value}` };
    if (f.type === 'image' || f.shape === 'image') return { name: 'image', why: 'it reads an image' };
    if (f.type === 'link' || f.shape === 'url') return { name: 'url', why: 'it reads a link' };
    if (f.shape === 'date' || DATE_TEXT.test(value)) return { name: 'date', why: `its value: ${value}` };
    if (/^h1$/i.test(f.name)) return { name: 'title', why: 'it is the page\'s heading' };
    if (value.length > 120) return { name: 'description', why: 'its value is a paragraph' };
    return { name: f.name.trim().toLowerCase() || 'field', why: 'its tag' };
}

/**
 * Names and types for the fields, in order. A field with a name someone gave keeps it; the rest get a proposal,
 * made unique (`price`, `price_2`).
 */
export function proposeFields(fields: PickedField[], types: FieldType[]): Proposal[] {
    const taken = new Set(fields.filter(f => !isPlaceholderName(f.name)).map(f => f.name.trim()));
    return fields.map((f, i) => {
        if (!isPlaceholderName(f.name)) return { name: f.name.trim(), type: types[i], why: 'given' };
        const { name, why } = nameFor(f);
        let unique = name;
        for (let n = 2; taken.has(unique); n++) unique = `${name}_${n}`;
        taken.add(unique);
        return { name: unique, type: typeFor(f, name), why };
    });
}
