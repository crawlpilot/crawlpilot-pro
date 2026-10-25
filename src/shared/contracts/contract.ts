import type { Column } from '../types/database';
/**
 * Output contracts: the shape a dataset is exported in, whatever site it came from (after thenos
 * `recipes-spi/verticals.py` and `schemas/retail.listing_item.v1.json`, Apache-2.0, reimplemented).
 * A contract lists typed fields; extracted columns are mapped onto them (automatically by name, type
 * and values, then fixed by the user); rows are converted by type (money → {amount, currency},
 * counts, ratings, booleans, clean URLs) and checked: required fields present, and each field filled
 * in at least its floor share of rows.
 */
import type { SchemaField } from '../ai/schemaIntake';
import { cleanUrl, parseBoolean, parseCount, parseDate, parseMoney, parseNumber, parseRating } from '../transforms/parsers';

export type ContractType = 'string' | 'url' | 'image' | 'money' | 'number' | 'integer' | 'rating' | 'count' | 'boolean' | 'date' | 'string[]';

export interface ContractField {
    name: string;
    type: ContractType;
    required?: boolean;
    description?: string;
    /** Share of rows that must have a value (thenos `x-thenos-coverage`); required fields default to 0.95. */
    floor?: number;
    /** Filled by the exporter, not mapped: `position` is the row's 1-based rank. */
    runtime?: 'position';
    /** Derived from another field when no column maps to it. */
    derive?: 'product_id_from_url';
    /** Column names that mean this field. */
    aliases?: string[];
    default?: unknown;
}

export interface Contract {
    id: string;
    label: string;
    fields: ContractField[];
}

export const REQUIRED_FLOOR = 0.95;

export const RETAIL_LISTING: Contract = {
    id: 'retail.listing_item@1',
    label: 'Retail listing item',
    fields: [
        { name: 'position', type: 'integer', required: true, runtime: 'position', description: '1-based rank of the item in the dataset' },
        { name: 'product_id', type: 'string', required: true, derive: 'product_id_from_url', aliases: ['id', 'sku', 'asin', 'item id', 'product id', 'model'], description: "The site's own id (ASIN, item id, SKU); taken from the URL when no column has it" },
        { name: 'title', type: 'string', required: true, aliases: ['name', 'product name', 'title', 'product title', 'heading'] },
        { name: 'url', type: 'url', required: true, aliases: ['url', 'link', 'href', 'product url', 'product link', 'title url'] },
        { name: 'image_url', type: 'image', aliases: ['image', 'images', 'img', 'thumbnail', 'photo', 'picture', 'image url'] },
        { name: 'brand', type: 'string', aliases: ['brand', 'brand name', 'manufacturer', 'seller', 'by'] },
        { name: 'price', type: 'money', floor: 0.7, aliases: ['price', 'current price', 'sale price', 'offers price', 'now'] },
        { name: 'list_price', type: 'money', aliases: ['was price', 'list price', 'original price', 'strike price', 'compare at', 'regular price', 'msrp', 'rrp'] },
        { name: 'rating', type: 'rating', aliases: ['rating', 'stars', 'rating value', 'average rating', 'review rating'] },
        { name: 'reviews_count', type: 'count', aliases: ['reviews', 'review count', 'reviews count', 'ratings', 'ratings count', 'number of ratings', 'product reviews'] },
        { name: 'sponsored', type: 'boolean', required: true, default: false, aliases: ['sponsored', 'ad', 'advertisement', 'promoted'] },
        { name: 'badges', type: 'string[]', aliases: ['badge', 'badges', 'badge tag', 'tag', 'tags', 'label', 'deal'] },
        { name: 'sales_volume', type: 'string', aliases: ['bought', 'sold', 'sales', 'sales volume'] },
        { name: 'shipping', type: 'string', aliases: ['shipping', 'delivery', 'fulfillment'] },
        { name: 'availability', type: 'string', aliases: ['availability', 'stock', 'in stock'] },
    ],
};

export const CONTRACT_PRESETS: Contract[] = [RETAIL_LISTING];

/** A contract from fields the user typed or pasted (JSON Schema, example object, lines). */
export function contractFromFields(fields: SchemaField[], label = 'Custom'): Contract {
    const typeOf = (f: SchemaField): ContractType => {
        if (f.type === 'url' || f.type === 'image' || f.type === 'boolean' || f.type === 'integer' || f.type === 'number') return f.type;
        if (/price|cost|amount|fee|salary/i.test(f.name)) return 'money';
        if (/rating|stars/i.test(f.name)) return 'rating';
        if (/count|reviews|ratings/i.test(f.name)) return 'count';
        if (/date|published|posted/i.test(f.name)) return 'date';
        return 'string';
    };
    return { id: 'custom', label, fields: fields.map(f => ({ name: f.name, type: typeOf(f), required: f.required, description: f.description })) };
}

// --------------------------------------------------------------------------------- conversion

function first(raw: unknown): unknown {
    if (typeof raw === 'string' && raw.startsWith('[')) {
        try { const a = JSON.parse(raw); if (Array.isArray(a)) return a[0]; } catch { /* plain text */ }
    }
    return Array.isArray(raw) ? raw[0] : raw;
}

function list(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
    if (typeof raw !== 'string') return raw == null ? [] : [String(raw)];
    if (raw.startsWith('[')) {
        try { const a = JSON.parse(raw); if (Array.isArray(a)) return a.map(String).filter(Boolean); } catch { /* plain text */ }
    }
    return raw.split(/\s*;\s*/).map(s => s.trim()).filter(Boolean);
}

/** One raw value as the field's type; undefined when it can't be read as that type. */
export function convertValue(field: ContractField, raw: unknown): unknown {
    if (raw === undefined || raw === null || raw === '') return undefined;
    switch (field.type) {
        case 'string': {
            const s = String(first(raw)).replace(/\s+/g, ' ').trim();
            return s || undefined;
        }
        case 'url': case 'image': return cleanUrl(first(raw), undefined, { stripTracking: true });
        case 'money': {
            const m = parseMoney(first(raw));
            return m ? { amount: m.amount, currency: m.currency } : undefined;
        }
        case 'number': return typeof raw === 'number' ? raw : parseNumber(String(first(raw)));
        case 'integer': {
            const n = typeof raw === 'number' ? raw : parseCount(String(first(raw)));
            return n === undefined ? undefined : Math.round(n);
        }
        case 'count': return parseCount(first(raw));
        case 'rating': return parseRating(first(raw));
        case 'date': return parseDate(first(raw));
        case 'boolean': {
            const b = parseBoolean(first(raw));
            if (b !== undefined) return b;
            // A column that holds a label ("Sponsored", "Ad") is true where the label is shown.
            return /\b(sponsored|ad|promoted|advertisement)\b/i.test(String(raw)) ? true : undefined;
        }
        case 'string[]': {
            const items = list(raw);
            return items.length ? items : undefined;
        }
    }
}

const PRODUCT_ID = [
    /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/, /\/gp\/product\/([A-Z0-9]{10})/, // Amazon ASIN
    /\/ip\/(?:[^/?]+\/)?(\d{5,})(?:[/?]|$)/, // Walmart item id
    /[/-]p[/-]?(\d{5,})(?:[/?.]|$)/i, /\/(?:product|item|p)\/([A-Za-z0-9_-]{4,})(?:[/?]|$)/i,
    /[-_/](\d{6,})(?:\.html?)?(?:[/?]|$)/,
];

export function productIdFromUrl(url: unknown): string | undefined {
    if (typeof url !== 'string') return undefined;
    for (const re of PRODUCT_ID) {
        const m = re.exec(url);
        if (m) return m[1];
    }
    return undefined;
}

// ------------------------------------------------------------------------------------ mapping

/** Contract field name → column id (null: no column). */
export type FieldMapping = Record<string, string | null>;

/** A column as the mapping sees it: any column type, or none. */
export type MappableColumn = Pick<Column, 'id' | 'name'> & { type?: string };

function tokens(s: string): string {
    return s.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[^a-z0-9]+/g, ' ').trim();
}

const TYPE_FIT: Record<ContractType, string[]> = {
    string: ['text', 'string', 'text_array'],
    url: ['url', 'link', 'link_array'],
    image: ['image', 'image_array'],
    money: ['price', 'money', 'number'],
    number: ['number', 'price', 'rating', 'count', 'integer'],
    integer: ['number', 'count', 'integer'],
    count: ['number', 'count', 'integer', 'text'],
    rating: ['number', 'rating', 'text'],
    boolean: ['boolean', 'text'],
    date: ['date', 'text'],
    'string[]': ['text', 'text_array', 'json'],
};

function nameScore(field: ContractField, col: MappableColumn): number {
    const c = tokens(col.name);
    const names = [field.name, ...(field.aliases ?? [])].map(tokens);
    if (names.includes(c)) return 3;
    // "Product Title" for title, "Offers Price" for price: the field's own name as a word of the column's.
    const words = c.split(' ');
    if (names.some(n => n && words.join(' ').includes(n) && n.length >= 3)) return 2;
    if (names.some(n => n.split(' ').every(w => words.includes(w)))) return 1.5;
    return 0;
}

/**
 * Maps columns onto the contract: every (field, column) pair is scored by name and alias, type fit and
 * whether the column's sample values convert, then the best pairs are taken greedily, each column
 * once. Weak pairs (score < 2) are left unmapped for the user.
 */
export function autoMap(contract: Contract, columns: MappableColumn[], rows: Record<string, unknown>[]): FieldMapping {
    const sample = rows.slice(0, 50);
    const pairs: { field: string; col: string; score: number }[] = [];
    for (const field of contract.fields) {
        if (field.runtime) continue;
        for (const col of columns) {
            if (col.id === 'recordId') continue;
            let score = nameScore(field, col);
            if (score === 0) continue;
            if (col.type && TYPE_FIT[field.type].includes(col.type)) score += 1;
            const values = sample.map(r => r[col.id]).filter(v => v !== undefined && v !== null && v !== '');
            if (values.length > 0) {
                const ok = values.filter(v => convertValue(field, v) !== undefined).length / values.length;
                if (ok >= 0.6) score += 1;
                else if (ok === 0 && score < 3) continue;
            }
            pairs.push({ field: field.name, col: col.id, score });
        }
    }
    pairs.sort((a, b) => b.score - a.score);
    const mapping: FieldMapping = Object.fromEntries(contract.fields.filter(f => !f.runtime).map(f => [f.name, null]));
    const usedCols = new Set<string>();
    for (const p of pairs) {
        if (p.score < 2 || mapping[p.field] !== null || usedCols.has(p.col)) continue;
        mapping[p.field] = p.col;
        usedCols.add(p.col);
    }
    return mapping;
}

// ----------------------------------------------------------------------------- shaping + checks

/** Rows shaped to the contract: one object per row, fields in contract order, unreadable values left out. */
export function shapeRows(contract: Contract, mapping: FieldMapping, rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return rows.map((row, i) => {
        const out: Record<string, unknown> = {};
        for (const f of contract.fields) {
            let v: unknown;
            if (f.runtime === 'position') v = i + 1;
            else {
                const col = mapping[f.name];
                v = col ? convertValue(f, row[col]) : undefined;
                if (v === undefined && f.derive === 'product_id_from_url') {
                    const urlCol = mapping.url;
                    v = urlCol ? productIdFromUrl(row[urlCol]) : undefined;
                }
                if (v === undefined && f.default !== undefined) v = f.default;
            }
            if (v !== undefined) out[f.name] = v;
        }
        return out;
    });
}

export interface ContractReport {
    /** Per field: share of shaped rows with a value. */
    coverage: Record<string, number>;
    /** Required fields with no column and no way to fill them. */
    unmappedRequired: string[];
    /** Fields under their floor (required fields: 95%). */
    underFloor: { name: string; fill: number; floor: number }[];
    /** Rows missing a required field. */
    invalidRows: number;
    ok: boolean;
}

export function checkContract(contract: Contract, mapping: FieldMapping, shaped: Record<string, unknown>[]): ContractReport {
    const n = shaped.length || 1;
    const coverage: Record<string, number> = {};
    for (const f of contract.fields) coverage[f.name] = shaped.filter(r => r[f.name] !== undefined).length / n;
    const unmappedRequired = contract.fields
        .filter(f => f.required && !f.runtime && f.default === undefined && !mapping[f.name] && !(f.derive && (coverage[f.name] ?? 0) > 0))
        .map(f => f.name);
    const underFloor = contract.fields
        .map(f => ({ name: f.name, fill: coverage[f.name], floor: f.floor ?? (f.required ? REQUIRED_FLOOR : 0) }))
        .filter(x => x.floor > 0 && x.fill < x.floor);
    const required = contract.fields.filter(f => f.required);
    const invalidRows = shaped.filter(r => required.some(f => r[f.name] === undefined)).length;
    return { coverage, unmappedRequired, underFloor, invalidRows, ok: unmappedRequired.length === 0 && underFloor.length === 0 };
}

/** The contract as JSON Schema (draft 2020-12) for an array of records, to ship with the export. */
export function contractJsonSchema(contract: Contract): object {
    const prop = (f: ContractField): object => {
        const base = f.description ? { description: f.description } : {};
        switch (f.type) {
            case 'money': return { ...base, type: 'object', required: ['amount'], properties: { amount: { type: 'number' }, currency: { type: ['string', 'null'] } } };
            case 'url': case 'image': return { ...base, type: 'string', format: 'uri' };
            case 'integer': case 'count': return { ...base, type: 'integer', minimum: 0 };
            case 'number': return { ...base, type: 'number' };
            case 'rating': return { ...base, type: 'number', minimum: 0, maximum: 5 };
            case 'boolean': return { ...base, type: 'boolean' };
            case 'date': return { ...base, type: 'string', format: 'date' };
            case 'string[]': return { ...base, type: 'array', items: { type: 'string' } };
            default: return { ...base, type: 'string', minLength: 1 };
        }
    };
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: contract.id,
        type: 'array',
        items: {
            type: 'object',
            additionalProperties: false,
            required: contract.fields.filter(f => f.required).map(f => f.name),
            properties: Object.fromEntries(contract.fields.map(f => [f.name, prop(f)])),
        },
    };
}
