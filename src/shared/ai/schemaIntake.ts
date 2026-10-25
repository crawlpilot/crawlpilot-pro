/**
 * Schema intake for AI extraction: the user describes the output as a JSON Schema, an example JSON
 * object, or plain lines ("price: the current selling price", "products[]:", "dimensions.width").
 * Every form becomes one normalised JSON Schema (`schemaNormalize.ts`), the contract the result follows;
 * its plan (`schemaPlan.ts`) gives the **single answers** (`fields`) and the **entity lists** (`lists`)
 * the pipeline reads, split from the schema alone (thenos `extract/schema.py`). Nested values have flat
 * keys (`address__city`); `assemble.ts` puts the result back in the schema's shape.
 */
import { normalizeSchemaInput, type JsonSchema } from './schemaNormalize';
import { planFields, planSchema, type SchemaPlan } from './schemaPlan';

export type SchemaFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'url' | 'image';

export interface SchemaField {
    /** The flat key the model writes (`price`, `address__city`). */
    name: string;
    description?: string;
    type: SchemaFieldType;
    required?: boolean;
    /** For people: `address.city`. */
    label?: string;
    enum?: (string | number)[];
    /** Several values (an array of scalars). */
    many?: boolean;
    /** Name → value pairs (an object with `additionalProperties`). */
    map?: boolean;
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
    /** The normalised JSON Schema: the shape of the result. */
    schema?: JsonSchema;
    plan?: SchemaPlan;
    /** What is read in a simpler way than the schema asks ("a list inside a list, read as text"). */
    problems?: string[];
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

export function parseSchemaInput(input: string): IntakeResult {
    const n = normalizeSchemaInput(input);
    if (!n.schema) return { fields: [], lists: [], source: n.source, problems: n.problems, error: n.error };
    const plan = planSchema(n.schema);
    const { fields, lists } = planFields(plan);
    const problems = [...n.problems, ...plan.problems];
    const count = fields.length + lists.reduce((k, l) => k + l.fields.length, 0);
    if (!count) return { fields, lists, source: n.source, schema: n.schema, plan, problems, error: 'There is nothing to extract in this schema.' };
    return { fields, lists, source: n.source, schema: n.schema, plan, problems };
}
