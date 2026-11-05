/**
 * A recipe's output contract (recipe-improvements-plan C15): the public contracts
 * (`shared/contracts/contract.ts`), named by a preset id, the bundled sample schema, or a pasted JSON
 * Schema. The tested records are mapped onto it (by name, or as the user set it), shaped and checked:
 * required fields mapped, each field filled on at least its floor share of pages.
 */
import { autoMap, checkContract, CONTRACT_PRESETS, shapeRows, type Contract, type ContractField, type ContractReport, type ContractType, type FieldMapping } from '../../shared/contracts/contract';
import { parseSchemaInput, type SchemaField } from '../../shared/ai/schemaIntake';
import fashionSchema from '../../shared/samples/fashion-product.schema.json';
import type { PageResult } from '../runner/testPage';
import type { Field, FieldType, PageRecipeSpec } from './types';

/** A contract from a JSON Schema (or an example object, or lines): its fields, types and required ones. */
export function contractFromSchema(text: string, id: string, label: string): Contract {
    const intake = parseSchemaInput(text);
    const typeOf = (f: SchemaField): ContractType =>
        f.many ? 'string[]' : f.type === 'url' || f.type === 'image' || f.type === 'boolean' || f.type === 'integer' || f.type === 'number' ? f.type : 'string';
    const fields: ContractField[] = intake.fields.map(f => ({ name: f.name, type: typeOf(f), ...(f.required ? { required: true } : {}), ...(f.description ? { description: f.description } : {}) }));
    if (fields.length === 0) throw new Error('No fields found in that schema.');
    return { id, label, fields };
}

/**
 * A product page's record, as retail consumers take it: the starting target schema for a product recipe's transform
 * (its mapping proposes rows from these names and aliases). A team's own schema replaces it by pasting it.
 */
export const RETAIL_PRODUCT: Contract = {
    id: 'retail.product@1',
    label: 'Retail product',
    fields: [
        { name: 'product_id', type: 'string', required: true, aliases: ['sku', 'asin', 'item id', 'us item id', 'product id', 'id', 'item number'], description: "The site's own id (ASIN, item id, SKU)" },
        { name: 'title', type: 'string', required: true, aliases: ['name', 'product name', 'product title', 'title'] },
        { name: 'brand', type: 'string', aliases: ['brand', 'brand name', 'manufacturer'] },
        { name: 'price', type: 'money', floor: 0.7, aliases: ['price', 'current price', 'sale price', 'is price', 'offer price', 'now price', 'price display'] },
        { name: 'list_price', type: 'money', aliases: ['was price', 'list price', 'original price', 'strike price', 'regular price', 'msrp'] },
        { name: 'rating', type: 'rating', aliases: ['rating', 'stars', 'average rating', 'rating value'] },
        { name: 'reviews_count', type: 'count', aliases: ['reviews', 'review count', 'reviews count', 'ratings count', 'number of ratings'] },
        { name: 'upc', type: 'string', aliases: ['upc', 'gtin', 'gtin13', 'ean', 'barcode'] },
        { name: 'model_number', type: 'string', aliases: ['model', 'model number', 'mpn', 'part number', 'manufacturer part number'] },
        { name: 'images', type: 'string[]', aliases: ['images', 'image', 'image url', 'all images', 'pictures', 'photos'] },
        { name: 'features', type: 'string[]', aliases: ['about item', 'about this item', 'highlights', 'features', 'key features', 'bullets'] },
        { name: 'category', type: 'string', aliases: ['category', 'breadcrumb', 'breadcrumbs', 'category path'] },
        { name: 'availability', type: 'string', aliases: ['availability', 'stock', 'in stock', 'availability status'] },
        { name: 'shipping', type: 'string', aliases: ['shipping', 'shipping charge', 'delivery'] },
        { name: 'seller', type: 'string', aliases: ['seller', 'sold by', 'merchant', 'seller name'] },
    ],
};

/** Contracts offered by name: the public presets, the retail product schema and the bundled sample schema. */
export const KNOWN_CONTRACTS: { id: string; label: string; contract: () => Contract }[] = [
    ...CONTRACT_PRESETS.map(c => ({ id: c.id, label: c.label, contract: () => c })),
    { id: RETAIL_PRODUCT.id, label: RETAIL_PRODUCT.label, contract: () => RETAIL_PRODUCT },
    { id: 'fashion-product.schema.json', label: 'Fashion product (sample schema)', contract: () => contractFromSchema(JSON.stringify(fashionSchema), 'fashion-product.schema.json', 'Fashion product') },
];

export function resolveContract(name: string): Contract | undefined {
    return KNOWN_CONTRACTS.find(c => c.id === name)?.contract();
}

/** How a recipe field's values look to the mapping's type fit. */
const COLUMN_TYPE: Record<FieldType, string> = {
    text: 'text', number: 'number', integer: 'integer', money: 'price', date: 'date', url: 'url', boolean: 'boolean',
    enum: 'text', list: 'text_array', object: 'text', table: 'json',
};

export interface ContractCheck {
    mapping: FieldMapping;
    report: ContractReport;
    /** Pages the check read (pages that could not be read are left out). */
    pages: number;
    /** What was checked: the fields by name, or the transform's output (its keys, dotted where nested). */
    on: 'fields' | 'transform';
}

/** An output record's values by dotted path (`offer.price`); lists stay values. */
export function flattenRecord(v: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        if (prefix) out[prefix] = v;
        return out;
    }
    for (const [k, x] of Object.entries(v)) flattenRecord(x, prefix ? `${prefix}.${k}` : k, out);
    return out;
}

/**
 * The tested pages checked against the contract. With a transform, its output is what consumers get, so that is
 * checked: each contract field is the output's key of that name (a transform that failed on a page gives nothing
 * there). Without one, the records named by field are mapped onto the contract (by name, or as the user set it).
 */
export function checkAgainstContract(contract: Contract, fields: Field[], results: PageResult[], mapping?: FieldMapping, transform?: PageRecipeSpec['transform']): ContractCheck {
    const read = results.filter(r => !r.error);
    if (transform?.jolt.length) {
        const records = read.map(r => r.recordError ? {} : flattenRecord(r.record));
        // The mapping's outputs are keys too, before any page is tested.
        const keys = new Set([...records.flatMap(r => Object.keys(r)), ...(transform.mapping ?? []).map(m => m.output)]);
        const map: FieldMapping = Object.fromEntries(contract.fields.filter(f => !f.runtime).map(f => [f.name, keys.has(f.name) ? f.name : null]));
        return { mapping: map, report: checkContract(contract, map, shapeRows(contract, map, records)), pages: read.length, on: 'transform' };
    }
    const records = read.map(r => Object.fromEntries(r.fields.map(f => [f.name, f.cleaned ?? null])));
    const columns = fields.map(f => ({ id: f.name, name: f.name, type: COLUMN_TYPE[f.type] }));
    const map = { ...autoMap(contract, columns, records), ...mapping };
    return { mapping: map, report: checkContract(contract, map, shapeRows(contract, map, records)), pages: read.length, on: 'fields' };
}

/** The contract's problems, one line each, for the readiness reasons. */
export function contractReasons(check: ContractCheck): string[] {
    return [
        ...check.report.unmappedRequired.map(name => check.on === 'transform'
            ? `Contract: the transform's output has no "${name}", which is required.`
            : `Contract: no field gives the required "${name}".`),
        ...(check.pages > 0 ? check.report.underFloor.filter(u => !check.report.unmappedRequired.includes(u.name))
            .map(u => `Contract: "${u.name}" is filled on ${Math.round(u.fill * 100)}% of pages; it needs ${Math.round(u.floor * 100)}%.`) : []),
    ];
}
