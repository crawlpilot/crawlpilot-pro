/**
 * Schema intake for AI extraction: the user describes the output as a JSON Schema, an example JSON
 * object, or plain lines ("price: the current selling price"). All become a flat list of fields.
 */

export type SchemaFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'url' | 'image';

export interface SchemaField {
    name: string;
    description?: string;
    type: SchemaFieldType;
    required?: boolean;
}

export interface IntakeResult {
    fields: SchemaField[];
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

function fromJsonSchema(schema: any): SchemaField[] {
    const props = schema?.properties ?? schema?.items?.properties;
    if (!props || typeof props !== 'object') return [];
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
    return Object.entries(props).map(([name, def]: [string, any]) => {
        const t = Array.isArray(def?.type) ? def.type.find((x: string) => x !== 'null') : def?.type;
        const format = def?.format;
        let type: SchemaFieldType = 'string';
        if (t === 'number' || t === 'integer' || t === 'boolean') type = t;
        else if (format === 'uri' || format === 'url') type = typeFromName(name) === 'image' ? 'image' : 'url';
        else type = typeFromName(name);
        return { name, description: def?.description, type, required: required.has(name) };
    });
}

function fromExample(example: Record<string, unknown>): SchemaField[] {
    return Object.entries(example).map(([name, v]) => {
        let type: SchemaFieldType = typeFromName(name);
        if (typeof v === 'number') type = Number.isInteger(v) ? 'integer' : 'number';
        else if (typeof v === 'boolean') type = 'boolean';
        else if (typeof v === 'string' && /^https?:\/\//.test(v)) type = typeFromName(name) === 'image' || /\.(jpe?g|png|webp|gif|avif)/i.test(v) ? 'image' : 'url';
        return { name, type, description: typeof v === 'string' && v.length < 80 ? `e.g. ${v}` : undefined };
    });
}

export function parseSchemaInput(input: string): IntakeResult {
    const text = input.trim();
    if (!text) return { fields: [], source: 'lines', error: 'Describe at least one field.' };

    if (text.startsWith('{')) {
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { return { fields: [], source: 'json-schema', error: 'This looks like JSON but does not parse.' }; }
        if (parsed && (parsed.properties || parsed.items?.properties || parsed.type === 'object')) {
            const fields = fromJsonSchema(parsed);
            return fields.length ? { fields, source: 'json-schema' } : { fields, source: 'json-schema', error: 'The schema has no properties.' };
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const fields = fromExample(parsed);
            return fields.length ? { fields, source: 'example' } : { fields, source: 'example', error: 'The example has no keys.' };
        }
        return { fields: [], source: 'example', error: 'Give a JSON object (an example record or a JSON Schema).' };
    }

    const fields: SchemaField[] = [];
    const seen = new Set<string>();
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/^[-*•\d.)\s]+/, '').trim();
        if (!line) continue;
        const idx = line.search(/[:=—–]/);
        const name = (idx > 0 ? line.slice(0, idx) : line).trim();
        const description = idx > 0 ? line.slice(idx + 1).trim() : undefined;
        if (!NAME_OK.test(name)) continue;
        const key = slug(name);
        if (seen.has(key)) continue;
        seen.add(key);
        fields.push({ name: key, description: description || undefined, type: typeFromName(name) });
    }
    return fields.length ? { fields, source: 'lines' } : { fields, source: 'lines', error: 'Write one field per line, like "price: the selling price".' };
}
