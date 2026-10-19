/**
 * Every way a user describes what to extract becomes one **normalised JSON Schema**
 * (docs/plans/ai-extract-v2-plan.md §3.1): lines (`price: the selling price`, `products[]:`,
 * `dimensions.width`), an example object, or a JSON Schema. The schema is the contract: the result is
 * JSON in its shape.
 *
 * Normalising keeps what shapes the output (`type`, `properties`, `required`, `items`, `enum`, `format`,
 * `minItems`/`maxItems`, `description` cut to 120 characters), resolves `$ref`s, and turns unions into one
 * type. What can't be supported is reported as a problem ("`oneOf` of objects: read as the first
 * option"), never dropped silently.
 */

export type JsonSchema = Record<string, any>;

export interface NormalizedSchema {
    /** The normalised schema; null when the input couldn't be read at all. */
    schema: JsonSchema | null;
    source: 'json-schema' | 'example' | 'lines';
    /** Things the schema asks for that are read in a simpler way. */
    problems: string[];
    /** Why nothing can be extracted (empty input, bad JSON, no fields). */
    error?: string;
}

const MAX_DEPTH = 4;
const MAX_DESCRIPTION = 120;
const FORMATS = new Set(['uri', 'url', 'email', 'date', 'date-time']);
const SCALARS = new Set(['string', 'number', 'integer', 'boolean']);

export function slugName(name: string): string {
    return name.trim().replace(/[\s-]+/g, '_').replace(/[^\w]/g, '').toLowerCase() || 'field';
}

/** `uri` for names that are links or images: they read a URL from the page. */
function formatFromName(name: string): string | undefined {
    return /image|photo|thumbnail|logo|picture|url|link|website|href/i.test(name) ? 'uri' : undefined;
}

const cut = (d: unknown) => (typeof d === 'string' && d.trim() ? d.trim().slice(0, MAX_DESCRIPTION) : undefined);

// ── JSON Schema ──

function normalizeJsonSchema(root: JsonSchema, problems: string[]): JsonSchema {
    const defs: JsonSchema = { ...(root.definitions ?? {}), ...(root.$defs ?? {}) };

    const walk = (node: any, at: string, depth: number): JsonSchema => {
        if (!node || typeof node !== 'object') return { type: 'string' };
        const ref = typeof node.$ref === 'string' ? node.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)?.[1] : undefined;
        if (typeof node.$ref === 'string') {
            if (ref === undefined || !defs[ref]) { problems.push(`${at || 'the schema'}: unknown $ref, read as text`); return { type: 'string' }; }
            const { $ref: _, ...rest } = node;
            return walk({ ...defs[ref], ...rest }, at, depth);
        }
        const union = node.oneOf ?? node.anyOf;
        if (Array.isArray(union) && !node.type) {
            const options = union.filter((u: any) => u?.type !== 'null');
            if (options.length > 1 && options.some((u: any) => u?.type === 'object' || u?.properties)) {
                problems.push(`${at || 'the schema'}: one of several shapes, read as the first`);
            }
            return walk({ ...(options[0] ?? { type: 'string' }), ...(node.description ? { description: node.description } : {}) }, at, depth);
        }

        let type = Array.isArray(node.type) ? node.type.filter((t: string) => t !== 'null') : node.type;
        if (Array.isArray(type)) {
            if (type.length > 1) problems.push(`${at}: several types, read as ${type[0]}`);
            type = type[0];
        }
        if (!type) type = node.properties ? 'object' : node.items ? 'array' : Array.isArray(node.enum) && typeof node.enum[0] === 'number' ? 'number' : 'string';

        const out: JsonSchema = { type };
        const description = cut(node.description ?? node.title);
        if (description) out.description = description;

        if ((type === 'object' || type === 'array') && depth >= MAX_DEPTH) {
            problems.push(`${at}: nested deeper than ${MAX_DEPTH} levels, read as text`);
            return { type: 'string', ...(description ? { description } : {}) };
        }
        if (type === 'object') {
            const props = node.properties ?? {};
            if (!Object.keys(props).length) {
                problems.push(`${at || 'the schema'}: an object with no properties, read as text`);
                return { type: 'string', ...(description ? { description } : {}) };
            }
            out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, walk(v, `${at}/${k}`, depth + 1)]));
            const required = Array.isArray(node.required) ? node.required.filter((r: string) => r in props) : [];
            if (required.length) out.required = required;
            return out;
        }
        if (type === 'array') {
            out.items = walk(node.items ?? { type: 'string' }, `${at}/*`, depth + 1);
            if (typeof node.minItems === 'number') out.minItems = node.minItems;
            if (typeof node.maxItems === 'number') out.maxItems = node.maxItems;
            return out;
        }
        if (!SCALARS.has(type)) { problems.push(`${at}: type "${type}" read as text`); out.type = 'string'; }
        if (Array.isArray(node.enum) && node.enum.length) out.enum = node.enum.filter((v: unknown) => v !== null).slice(0, 50);
        const format = node.format === 'url' ? 'uri' : node.format;
        if (typeof format === 'string' && FORMATS.has(format)) out.format = format;
        return out;
    };
    return walk(root, '', 0);
}

// ── Example ──

function fromExample(value: unknown, name: string, depth: number): JsonSchema {
    if (Array.isArray(value)) {
        const objects = value.filter(v => v && typeof v === 'object' && !Array.isArray(v)) as Record<string, unknown>[];
        if (objects.length) {
            // The keys of the first few items together: one example item may leave a field out.
            const merged: Record<string, unknown> = {};
            for (const o of objects.slice(0, 3)) for (const [k, v] of Object.entries(o)) if (!(k in merged) || merged[k] === null) merged[k] = v;
            return { type: 'array', items: fromExample(merged, name, depth + 1) };
        }
        return { type: 'array', items: fromExample(value[0] ?? '', name, depth + 1) };
    }
    if (value && typeof value === 'object') {
        return { type: 'object', properties: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromExample(v, k, depth + 1)])) };
    }
    if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
    if (typeof value === 'boolean') return { type: 'boolean' };
    const out: JsonSchema = { type: 'string' };
    if (typeof value === 'string' && /^https?:\/\//.test(value)) out.format = 'uri';
    else {
        const format = formatFromName(name);
        if (format) out.format = format;
    }
    if (typeof value === 'string' && value && value.length < 80 && !out.format) out.description = `e.g. ${value}`;
    return out;
}

// ── Lines ──

const NAME = /^[A-Za-z_][\w -]{0,60}$/;

interface LineField { path: string[]; description?: string }

function parseLine(line: string): LineField | null {
    const idx = line.search(/[:=—–]/);
    const raw = (idx > 0 ? line.slice(0, idx) : line).trim();
    const description = idx > 0 ? line.slice(idx + 1).trim() || undefined : undefined;
    const parts = raw.split('.').map(p => p.trim());
    if (!parts.length || parts.some(p => !NAME.test(p))) return null;
    return { path: parts.map(slugName), description };
}

/** Puts a leaf at `path` inside `obj` (an object schema), creating objects on the way. */
function place(obj: JsonSchema, path: string[], leaf: JsonSchema) {
    let at = obj;
    for (const part of path.slice(0, -1)) {
        at.properties ??= {};
        if (at.properties[part]?.type !== 'object') at.properties[part] = { type: 'object', properties: {} };
        at = at.properties[part];
    }
    at.properties ??= {};
    const name = path[path.length - 1];
    if (!at.properties[name]) at.properties[name] = leaf;
}

function leafFor(f: LineField): JsonSchema {
    const name = f.path[f.path.length - 1];
    const format = formatFromName(name);
    return { type: 'string', ...(f.description ? { description: cut(f.description) } : {}), ...(format ? { format } : {}) };
}

function fromLines(text: string): JsonSchema {
    const root: JsonSchema = { type: 'object', properties: {} };
    let list: { item: JsonSchema; node: JsonSchema } | null = null;
    for (const raw of text.split(/\r?\n/)) {
        if (!raw.trim()) continue;
        const indented = /^\s+/.test(raw) && list !== null;
        const line = raw.replace(/^[-*•\d.)\s]+/, '').trim();
        // `products[]: description` or `products[]: title, price, url` opens a list; `tags[]: …` with no
        // indented fields under it is a list of values.
        const opener = /^([A-Za-z_][\w -]{0,60})\[\]\s*(?:[:=—–]\s*(.*))?$/.exec(line);
        if (opener && !indented) {
            const item: JsonSchema = { type: 'object', properties: {} };
            const node: JsonSchema = { type: 'array', items: item };
            const rest = (opener[2] ?? '').trim();
            if (rest.includes(',')) {
                for (const part of rest.split(',')) { const f = parseLine(part.trim()); if (f) place(item, f.path, leafFor(f)); }
            } else if (rest) node.description = cut(rest);
            root.properties[slugName(opener[1])] = node;
            list = { item, node };
            continue;
        }
        const f = parseLine(line);
        if (!f) continue;
        if (indented) { place(list!.item, f.path, leafFor(f)); continue; }
        list = null;
        place(root, f.path, leafFor(f));
    }
    // A list opened with no fields under it is a list of values (`tags[]: the product's tags`).
    for (const [k, v] of Object.entries(root.properties) as [string, JsonSchema][]) {
        if (v.type === 'array' && !Object.keys(v.items.properties ?? {}).length) {
            root.properties[k] = { type: 'array', items: { type: 'string', ...(formatFromName(k) ? { format: 'uri' } : {}) }, ...(v.description ? { description: v.description } : {}) };
        }
    }
    return root;
}

/** Number of values the schema asks for (leaves, list item fields counted once). */
export function countLeaves(schema: JsonSchema | null | undefined): number {
    if (!schema) return 0;
    if (schema.type === 'object') return Object.values(schema.properties ?? {}).reduce((n: number, v) => n + countLeaves(v as JsonSchema), 0);
    if (schema.type === 'array') return countLeaves(schema.items);
    return 1;
}

export function normalizeSchemaInput(input: string): NormalizedSchema {
    const text = input.trim();
    if (!text) return { schema: null, source: 'lines', problems: [], error: 'Describe at least one field.' };
    const problems: string[] = [];

    if (text.startsWith('{') || text.startsWith('[')) {
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { return { schema: null, source: 'json-schema', problems, error: 'This looks like JSON but does not parse.' }; }
        const isSchema = parsed && !Array.isArray(parsed) && (parsed.properties || parsed.$schema || ((parsed.type === 'object' || parsed.type === 'array') && (parsed.properties || parsed.items)));
        if (isSchema) {
            const schema = normalizeJsonSchema(parsed, problems);
            return countLeaves(schema) && schema.type !== 'string'
                ? { schema, source: 'json-schema', problems }
                : { schema: null, source: 'json-schema', problems, error: 'The schema has no properties.' };
        }
        if (parsed && typeof parsed === 'object') {
            const schema = fromExample(Array.isArray(parsed) ? parsed : parsed, 'items', 0);
            const ok = countLeaves(schema) > 0 && (schema.type === 'object' ? Object.keys(schema.properties).length > 0 : schema.items?.type === 'object');
            return ok ? { schema, source: 'example', problems } : { schema: null, source: 'example', problems, error: 'The example has no keys.' };
        }
        return { schema: null, source: 'example', problems, error: 'Give a JSON object (an example record or a JSON Schema).' };
    }

    const schema = fromLines(text);
    return Object.keys(schema.properties).length
        ? { schema, source: 'lines', problems }
        : { schema: null, source: 'lines', problems, error: 'Write one field per line, like "price: the selling price".' };
}
