/**
 * Schema intake for AI extraction: the user describes the output as a JSON Schema, an example JSON
 * object, or plain lines ("price: the current selling price"). The result is the **single answers**
 * (`fields`: one value each for the page) and the **entity lists** (`lists`: many items, each with
 * its own fields), split from the schema alone (thenos `extract/schema.py`): a top-level array of
 * objects is a list, anything else a single answer. Lines declare a list as `products[]:` followed
 * by its indented fields, or `products[]: title, price, url`.
 */

export type SchemaFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'url' | 'image';

export interface SchemaField {
    name: string;
    description?: string;
    type: SchemaFieldType;
    required?: boolean;
}

/** An entity list: many items on the page, each read into `fields`. */
export interface SchemaList {
    name: string;
    description?: string;
    fields: SchemaField[];
}

export interface IntakeResult {
    /** Single answers. */
    fields: SchemaField[];
    lists: SchemaList[];
    source: 'json-schema' | 'example' | 'lines';
    error?: string;
}

export const SCHEMA_PRESETS: Record<string, { label: string; text: string }> = {
    product: {
        label: 'Product',
        text: [
            'title: product name as shown in the main heading',
            'price: current selling price with currency symbol',
            'list_price: original or struck-through price, if shown',
            'brand: brand or manufacturer',
            'rating: average star rating',
            'reviews_count: number of reviews or ratings',
            'availability: stock or delivery availability text',
            'image: main product image',
            'sku: product id, SKU or model number',
        ].join('\n'),
    },
    listing: {
        label: 'Product listing',
        text: [
            'products[]: every product shown in the results',
            '  title: product name',
            '  price: current selling price with currency symbol',
            '  url: link to the product page',
            '  image: product image',
            '  rating: average star rating',
            '  reviews_count: number of reviews',
        ].join('\n'),
    },
    article: {
        label: 'Article',
        text: [
            'title: article headline',
            'author: author name',
            'published: publication date',
            'summary: standfirst or first paragraph',
            'image: lead image',
        ].join('\n'),
    },
    job: {
        label: 'Job posting',
        text: [
            'title: job title',
            'company: hiring company',
            'location: job location',
            'salary: salary or pay range, if shown',
            'employment_type: full-time, part-time, contract…',
            'posted: date posted',
        ].join('\n'),
    },
    contact: {
        label: 'Business / contact',
        text: [
            'name: business or person name',
            'phone: phone number',
            'email: email address',
            'address: street address',
            'website: website link',
            'hours: opening hours',
        ].join('\n'),
    },
};

const NAME_OK = /^[A-Za-z_][\w -]{0,60}$/;

function slug(name: string): string {
    return name.trim().replace(/[\s-]+/g, '_').replace(/[^\w]/g, '').toLowerCase() || 'field';
}

function typeFromName(name: string): SchemaFieldType {
    const n = name.toLowerCase();
    if (/image|photo|thumbnail|logo|picture/.test(n)) return 'image';
    if (/url|link|website|href/.test(n)) return 'url';
    return 'string';
}

function fieldFromJsonSchema(name: string, def: any, required: boolean): SchemaField {
    const t = Array.isArray(def?.type) ? def.type.find((x: string) => x !== 'null') : def?.type;
    const format = def?.format;
    let type: SchemaFieldType = 'string';
    if (t === 'number' || t === 'integer' || t === 'boolean') type = t;
    else if (format === 'uri' || format === 'url') type = typeFromName(name) === 'image' ? 'image' : 'url';
    else type = typeFromName(name);
    return { name, description: def?.description, type, required };
}

function resolveRef(def: any, root: any): any {
    const ref = typeof def?.$ref === 'string' ? def.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)?.[1] : undefined;
    return ref ? (root.$defs?.[ref] ?? root.definitions?.[ref] ?? def) : def;
}

function fromJsonSchema(schema: any): { fields: SchemaField[]; lists: SchemaList[] } {
    // A schema that is itself an array of objects is one list.
    if (schema?.type === 'array' && resolveRef(schema.items, schema)?.properties) {
        const items = resolveRef(schema.items, schema);
        return { fields: [], lists: [{ name: 'items', description: schema.description, fields: objectFields(items, schema) }] };
    }
    const props = schema?.properties;
    if (!props || typeof props !== 'object') return { fields: [], lists: [] };
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
    const fields: SchemaField[] = [];
    const lists: SchemaList[] = [];
    for (const [name, raw] of Object.entries(props) as [string, any][]) {
        const def = resolveRef(raw, schema);
        const items = def?.type === 'array' ? resolveRef(def.items, schema) : undefined;
        if (items?.properties) lists.push({ name, description: def.description, fields: objectFields(items, schema) });
        else fields.push(fieldFromJsonSchema(name, def, required.has(name)));
    }
    return { fields, lists };
}

function objectFields(def: any, root: any): SchemaField[] {
    const required = new Set<string>(Array.isArray(def.required) ? def.required : []);
    return Object.entries(def.properties ?? {}).map(([name, raw]) => fieldFromJsonSchema(name, resolveRef(raw, root), required.has(name)));
}

function fieldFromExample(name: string, v: unknown): SchemaField {
    let type: SchemaFieldType = typeFromName(name);
    if (typeof v === 'number') type = Number.isInteger(v) ? 'integer' : 'number';
    else if (typeof v === 'boolean') type = 'boolean';
    else if (typeof v === 'string' && /^https?:\/\//.test(v)) type = typeFromName(name) === 'image' || /\.(jpe?g|png|webp|gif|avif)/i.test(v) ? 'image' : 'url';
    return { name, type, description: typeof v === 'string' && v.length < 80 ? `e.g. ${v}` : undefined };
}

function fromExample(example: Record<string, unknown>): { fields: SchemaField[]; lists: SchemaList[] } {
    const fields: SchemaField[] = [];
    const lists: SchemaList[] = [];
    for (const [name, v] of Object.entries(example)) {
        const first = Array.isArray(v) ? v[0] : undefined;
        if (first && typeof first === 'object' && !Array.isArray(first)) {
            lists.push({ name, fields: Object.entries(first as Record<string, unknown>).map(([k, x]) => fieldFromExample(k, x)) });
        } else fields.push(fieldFromExample(name, v));
    }
    return { fields, lists };
}

const fieldCount = (r: { fields: SchemaField[]; lists: SchemaList[] }) => r.fields.length + r.lists.reduce((n, l) => n + l.fields.length, 0);

function fieldLine(line: string): SchemaField | null {
    const idx = line.search(/[:=—–]/);
    const name = (idx > 0 ? line.slice(0, idx) : line).trim();
    const description = idx > 0 ? line.slice(idx + 1).trim() : undefined;
    if (!NAME_OK.test(name)) return null;
    return { name: slug(name), description: description || undefined, type: typeFromName(name) };
}

export function parseSchemaInput(input: string): IntakeResult {
    const text = input.trim();
    if (!text) return { fields: [], lists: [], source: 'lines', error: 'Describe at least one field.' };

    if (text.startsWith('{') || text.startsWith('[')) {
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { return { fields: [], lists: [], source: 'json-schema', error: 'This looks like JSON but does not parse.' }; }
        if (parsed && !Array.isArray(parsed) && (parsed.properties || parsed.type === 'object' || parsed.type === 'array')) {
            const r = fromJsonSchema(parsed);
            return fieldCount(r) ? { ...r, source: 'json-schema' } : { ...r, source: 'json-schema', error: 'The schema has no properties.' };
        }
        const example = Array.isArray(parsed) ? { items: parsed } : parsed;
        if (example && typeof example === 'object') {
            const r = fromExample(example);
            return fieldCount(r) ? { ...r, source: 'example' } : { ...r, source: 'example', error: 'The example has no keys.' };
        }
        return { fields: [], lists: [], source: 'example', error: 'Give a JSON object (an example record or a JSON Schema).' };
    }

    const fields: SchemaField[] = [];
    const lists: SchemaList[] = [];
    const seen = new Set<string>();
    let list: SchemaList | null = null;
    for (const raw of text.split(/\r?\n/)) {
        if (!raw.trim()) continue;
        const indented = /^\s+/.test(raw) && list !== null;
        const line = raw.replace(/^[-*•\d.)\s]+/, '').trim();
        // `products[]: description` or `products[]: title, price, url` opens a list.
        const opener = /^([A-Za-z_][\w -]{0,60})\[\]\s*(?:[:=—–]\s*(.*))?$/.exec(line);
        if (opener) {
            list = { name: slug(opener[1]), fields: [] };
            const rest = (opener[2] ?? '').trim();
            if (rest && rest.includes(',')) {
                for (const part of rest.split(',')) { const f = fieldLine(part.trim()); if (f) list.fields.push(f); }
            } else if (rest) list.description = rest;
            lists.push(list);
            continue;
        }
        const f = fieldLine(line);
        if (!f) continue;
        if (indented) {
            if (!list!.fields.some(x => x.name === f.name)) list!.fields.push(f);
            continue;
        }
        list = null;
        if (seen.has(f.name)) continue;
        seen.add(f.name);
        fields.push(f);
    }
    const kept = lists.filter(l => l.fields.length > 0);
    const r = { fields, lists: kept };
    return fieldCount(r) ? { ...r, source: 'lines' } : { ...r, source: 'lines', error: 'Write one field per line, like "price: the selling price".' };
}
