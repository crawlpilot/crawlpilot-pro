/**
 * What a normalised schema asks the model for (docs/plans/ai-extract-v2-plan.md §3.1):
 *
 * - **Leaves:** every scalar to fill, with its JSON pointer (`/address/city`), a flat key the model
 *   writes (`address__city`), its type, enum, format and whether it is required. An array of scalars
 *   (`tags: string[]`) is one leaf holding several values.
 * - **The split** (thenos `split_schema`): each top-level array of objects is an **entity list**, read
 *   item by item; everything else is a **single answer**. A schema that is itself an array of objects is
 *   one list at the root.
 *
 * The model only ever writes flat `{key: value}` answers; `assemble.ts` rebuilds the nesting. Nesting is
 * cheap in code and costly for a small model.
 */
import type { JsonSchema } from './schemaNormalize';
import type { SchemaField, SchemaFieldType, SchemaList } from './schemaIntake';

export interface Leaf {
    /** Flat key the model writes: `address__city`. Unique within its list or the single answers. */
    key: string;
    /** Path inside the result (single answers) or inside one list item (list leaves). */
    path: string[];
    /** JSON pointer of the same: `/address/city`. */
    pointer: string;
    /** For people: `address.city`. */
    label: string;
    type: 'string' | 'number' | 'integer' | 'boolean';
    /** `url`/`image` read a URL from the page; the rest are their JSON type. */
    kind: SchemaFieldType;
    format?: string;
    enum?: (string | number)[];
    required: boolean;
    /** An array of scalars: several values. */
    many: boolean;
    /** An object of name → value pairs the page decides (`additionalProperties` only): specs, attributes. */
    map?: boolean;
    description?: string;
}

export interface ListPlan {
    /** Flat key: the property name, or `items` for a schema that is itself a list. */
    key: string;
    /** Pointer of the array in the result: `/products`, or `` for a schema that is itself a list. */
    pointer: string;
    description?: string;
    /** Leaves of one item, paths relative to the item. */
    leaves: Leaf[];
}

export interface SchemaPlan {
    single: Leaf[];
    lists: ListPlan[];
    /** The schema is itself an array of objects: the result is that array. */
    rootList: boolean;
    problems: string[];
}

const IMAGE = /image|photo|thumbnail|logo|picture|img/i;

const pointerOf = (path: string[]) => path.map(p => `/${p.replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');

function kindOf(type: Leaf['type'], format: string | undefined, name: string): SchemaFieldType {
    if (type !== 'string') return type;
    if (format === 'uri') return IMAGE.test(name) ? 'image' : 'url';
    return 'string';
}

/** The leaves under `node` at `path`. Arrays of objects below the top level are read as text. */
function leavesOf(node: JsonSchema, path: string[], required: boolean, problems: string[], out: Leaf[]) {
    if (node.type === 'object' && !Object.keys(node.properties ?? {}).length && node.additionalProperties) {
        out.push({
            key: path.join('__') || 'value', path, pointer: pointerOf(path), label: path.join('.') || 'value',
            type: 'string', kind: 'string', required, many: false, map: true,
            ...(node.description ? { description: node.description } : {}),
        });
        return;
    }
    if (node.type === 'object') {
        const req = new Set<string>(node.required ?? []);
        for (const [name, child] of Object.entries(node.properties ?? {})) leavesOf(child as JsonSchema, [...path, name], req.has(name), problems, out);
        return;
    }
    let many = false;
    let leaf = node;
    if (node.type === 'array') {
        if (node.items?.type === 'object' || node.items?.type === 'array') {
            problems.push(`${path.join('.')}: a list inside a list, read as text`);
            leaf = { type: 'string', description: node.description };
        } else {
            many = true;
            leaf = { ...node.items, description: node.items?.description ?? node.description };
        }
    }
    const name = path[path.length - 1] ?? 'value';
    const type = (['string', 'number', 'integer', 'boolean'].includes(leaf.type) ? leaf.type : 'string') as Leaf['type'];
    out.push({
        key: path.join('__') || 'value',
        path,
        pointer: pointerOf(path),
        label: path.join('.') || 'value',
        type,
        kind: kindOf(type, leaf.format, name),
        ...(leaf.format ? { format: leaf.format } : {}),
        ...(leaf.enum ? { enum: leaf.enum } : {}),
        required,
        many,
        ...(leaf.description ? { description: leaf.description } : {}),
    });
}

const isEntityList = (node: JsonSchema | undefined) => node?.type === 'array' && node.items?.type === 'object';

export function planSchema(schema: JsonSchema): SchemaPlan {
    const problems: string[] = [];
    if (isEntityList(schema)) {
        const leaves: Leaf[] = [];
        leavesOf(schema.items, [], false, problems, leaves);
        return { single: [], lists: [{ key: 'items', pointer: '', description: schema.description, leaves }], rootList: true, problems };
    }
    const single: Leaf[] = [];
    const lists: ListPlan[] = [];
    const required = new Set<string>(schema.required ?? []);
    for (const [name, node] of Object.entries(schema.properties ?? {}) as [string, JsonSchema][]) {
        if (isEntityList(node)) {
            const leaves: Leaf[] = [];
            leavesOf(node.items, [], false, problems, leaves);
            lists.push({ key: name, pointer: pointerOf([name]), description: node.description, leaves });
        } else leavesOf(node, [name], required.has(name), problems, single);
    }
    return { single, lists, rootList: false, problems };
}

/** What the model is told about a leaf: its description, the values an enum allows, how to list many. */
function guidance(leaf: Leaf): string | undefined {
    const parts: string[] = [];
    if (leaf.description) parts.push(leaf.description);
    if (leaf.path.length > 1) parts.push(`(${leaf.label})`);
    if (leaf.enum) parts.push(`one of: ${leaf.enum.join(', ')}`);
    if (leaf.format === 'date' || leaf.format === 'date-time') parts.push('a date');
    if (leaf.format === 'email') parts.push('an email address');
    if (leaf.many) parts.push("every one shown, separated by ' | '");
    if (leaf.map) parts.push("each as 'name: value', separated by ' | '");
    return parts.length ? parts.join('; ') : undefined;
}

/** A leaf as the extraction pipeline's field: the flat key, its kind, and the guidance. */
export function fieldOf(leaf: Leaf): SchemaField {
    return {
        name: leaf.key,
        type: leaf.kind,
        required: leaf.required,
        ...(guidance(leaf) ? { description: guidance(leaf) } : {}),
        label: leaf.label,
        ...(leaf.enum ? { enum: leaf.enum } : {}),
        ...(leaf.many ? { many: true } : {}),
        ...(leaf.map ? { map: true } : {}),
    };
}

/** The plan as the pipeline's single fields and lists. */
export function planFields(plan: SchemaPlan): { fields: SchemaField[]; lists: SchemaList[] } {
    return {
        fields: plan.single.map(fieldOf),
        lists: plan.lists.map(l => ({ name: l.key, ...(l.description ? { description: l.description } : {}), fields: l.leaves.map(fieldOf) })),
    };
}
