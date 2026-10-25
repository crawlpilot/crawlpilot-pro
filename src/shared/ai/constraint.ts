/**
 * The JSON Schema sent as the Prompt API's `responseConstraint`, compiled from a schema a user (or a
 * prompt builder) wrote. The user's schema is input, not something to hand to the model as is:
 *
 * - `$ref`s into `$defs`/`definitions` are resolved (depth-limited, so a recursive schema ends).
 * - Only keywords that shape the output are kept: `type`, `properties`, `required`, `items`, `enum`,
 *   `additionalProperties`, `minItems`/`maxItems`, `pattern`, and `description` (guidance the model
 *   reads). Annotations (`$schema`, `title`, `examples`, `default`, `format`) are dropped.
 * - Every array gets a `maxItems`: unbounded arrays are how a small model runs away.
 * - A union of primitives (`oneOf`/`anyOf`, `type: [...]`) becomes one type, `null` dropped.
 *
 * Chrome rejects a schema feature it can't enforce with `NotSupportedError`, so `relax` gives the
 * order in which to give features up (docs/plans/ai-extract-markdown-plan.md §3.9.4).
 */

export type JsonSchema = Record<string, any>;

const KEEP = new Set(['type', 'properties', 'required', 'items', 'enum', 'additionalProperties', 'minItems', 'maxItems', 'pattern', 'description']);
const MAX_REF_DEPTH = 8;
export const DEFAULT_MAX_ITEMS = 20;

export interface CompileOptions {
    /** `maxItems` for arrays that have none. */
    maxItems?: number;
    /** Drop `description`s (with `omitResponseConstraintInput` the model never sees the schema). */
    descriptions?: boolean;
}

export function compileConstraint(schema: JsonSchema, options: CompileOptions = {}): JsonSchema {
    const defs: JsonSchema = { ...(schema.definitions ?? {}), ...(schema.$defs ?? {}) };
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    const descriptions = options.descriptions ?? true;

    const walk = (node: any, depth: number): JsonSchema => {
        if (!node || typeof node !== 'object') return { type: 'string' };
        const ref = typeof node.$ref === 'string' ? node.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)?.[1] : undefined;
        if (ref !== undefined) return depth < MAX_REF_DEPTH && defs[ref] ? walk({ ...defs[ref], ...without(node, '$ref') }, depth + 1) : { type: 'string' };

        const union = node.oneOf ?? node.anyOf;
        if (Array.isArray(union) && !node.type) {
            const options = union.filter((u: any) => u?.type !== 'null');
            const objectLike = options.find((u: any) => u?.type === 'object' || u?.type === 'array' || u?.$ref);
            const pick = objectLike ?? (options.every((u: any) => u?.type === options[0]?.type) ? options[0] : { type: 'string' });
            return walk({ ...pick, ...(node.description ? { description: node.description } : {}) }, depth + 1);
        }

        const out: JsonSchema = {};
        for (const [k, v] of Object.entries(node)) {
            if (!KEEP.has(k)) continue;
            if (k === 'description' && !descriptions) continue;
            out[k] = v;
        }
        if (Array.isArray(out.type)) {
            const real = out.type.filter((t: string) => t !== 'null');
            out.type = real.length === 1 ? real[0] : 'string';
        }
        if (!out.type) out.type = node.properties ? 'object' : node.items ? 'array' : out.enum ? typeof out.enum[0] === 'number' ? 'number' : 'string' : 'string';
        if (out.type === 'object') {
            const props = node.properties ?? {};
            out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, walk(v, depth + 1)]));
            if (Array.isArray(node.required)) out.required = node.required.filter((r: string) => r in props);
            out.additionalProperties = false;
        } else {
            delete out.properties;
            delete out.additionalProperties;
            delete out.required;
        }
        if (out.type === 'array') {
            out.items = walk(node.items ?? { type: 'string' }, depth + 1);
            out.maxItems = Math.min(typeof node.maxItems === 'number' ? node.maxItems : maxItems, maxItems);
        } else {
            delete out.items;
            delete out.maxItems;
            delete out.minItems;
        }
        if (out.type !== 'string') delete out.pattern;
        return out;
    };
    return walk(schema, 0);
}

function without(node: JsonSchema, key: string): JsonSchema {
    const { [key]: _, ...rest } = node;
    return rest;
}

/** What `relax` gives up, in order: string patterns, then enums, then structure below the top object. */
export const RELAXATIONS = ['pattern', 'enum', 'depth'] as const;

/** The schema with one more feature given up (`step` indexes RELAXATIONS); `null` past the last. */
export function relax(schema: JsonSchema, step: number): JsonSchema | null {
    const what = RELAXATIONS[step];
    if (!what) return null;
    const walk = (node: JsonSchema, depth: number): JsonSchema => {
        const out: JsonSchema = { ...node };
        if (what === 'pattern') delete out.pattern;
        if (what === 'enum' && out.enum) { delete out.enum; out.type = out.type === 'number' || out.type === 'integer' ? out.type : 'string'; }
        if (what === 'depth' && depth >= 2 && (out.type === 'object' || out.type === 'array')) {
            return { type: 'string', ...(out.description ? { description: out.description } : {}) };
        }
        if (out.properties) out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, walk(v as JsonSchema, depth + 1)]));
        if (out.items) out.items = walk(out.items, depth + 1);
        return out;
    };
    // Every step includes the ones before it.
    const before = step > 0 ? relax(schema, step - 1)! : schema;
    return walk(before, 0);
}
