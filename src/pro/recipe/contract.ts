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
import type { Field, FieldType } from './types';

/** A contract from a JSON Schema (or an example object, or lines): its fields, types and required ones. */
export function contractFromSchema(text: string, id: string, label: string): Contract {
    const intake = parseSchemaInput(text);
    const typeOf = (f: SchemaField): ContractType =>
        f.many ? 'string[]' : f.type === 'url' || f.type === 'image' || f.type === 'boolean' || f.type === 'integer' || f.type === 'number' ? f.type : 'string';
    const fields: ContractField[] = intake.fields.map(f => ({ name: f.name, type: typeOf(f), ...(f.required ? { required: true } : {}), ...(f.description ? { description: f.description } : {}) }));
    if (fields.length === 0) throw new Error('No fields found in that schema.');
    return { id, label, fields };
}

/** Contracts offered by name: the public presets and the bundled sample schema. */
export const KNOWN_CONTRACTS: { id: string; label: string; contract: () => Contract }[] = [
    ...CONTRACT_PRESETS.map(c => ({ id: c.id, label: c.label, contract: () => c })),
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
}

/** The tested pages as records named by field, mapped onto the contract and checked. */
export function checkAgainstContract(contract: Contract, fields: Field[], results: PageResult[], mapping?: FieldMapping): ContractCheck {
    const read = results.filter(r => !r.error);
    const records = read.map(r => Object.fromEntries(r.fields.map(f => [f.name, f.cleaned ?? null])));
    const columns = fields.map(f => ({ id: f.name, name: f.name, type: COLUMN_TYPE[f.type] }));
    const map = { ...autoMap(contract, columns, records), ...mapping };
    return { mapping: map, report: checkContract(contract, map, shapeRows(contract, map, records)), pages: read.length };
}

/** The contract's problems, one line each, for the readiness reasons. */
export function contractReasons(check: ContractCheck): string[] {
    return [
        ...check.report.unmappedRequired.map(name => `Contract: no field gives the required "${name}".`),
        ...(check.pages > 0 ? check.report.underFloor.filter(u => !check.report.unmappedRequired.includes(u.name))
            .map(u => `Contract: "${u.name}" is filled on ${Math.round(u.fill * 100)}% of pages; it needs ${Math.round(u.floor * 100)}%.`) : []),
    ];
}
