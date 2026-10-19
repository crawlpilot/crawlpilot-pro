/**
 * Sizing model calls for Gemini Nano (docs/plans/ai-extract-v2-plan.md §3.2). The window is small and
 * measured; a small model also gets worse the longer the JSON it writes. So every call asks for little:
 *
 * - **Output reserve from the schema.** What an answer costs, per field, by type: a number is short, a
 *   URL long, several values longer still. The input gets what the reserve leaves.
 * - **Field groups.** Single answers go at most 8 fields (and about 300 answer tokens) to a call;
 *   fields under one parent (`dimensions.width`, `dimensions.height`) stay in one group.
 * - **List passes.** An item of up to 8 fields is read in one pass. A wider item is read in passes,
 *   each with the item's identifying fields (name, URL, id) plus up to 8 others; passes are joined on
 *   those fields.
 * - **Items per chunk** from the item's cost: as many as fit the list answer budget, 5 to 20.
 * - **Caps:** at most 8 chunks per list pass and 40 calls per page; reaching one is a warning.
 */
import type { SchemaField, SchemaList } from '../../../shared/ai/schemaIntake';

export const MAX_GROUP_FIELDS = 8;
export const MAX_GROUP_TOKENS = 300;
/** Answer tokens one list call may write. */
export const LIST_ANSWER_TOKENS = 900;
export const MIN_ITEMS = 5;
export const MAX_ITEMS = 20;
export const MAX_LIST_CHUNKS = 8;
export const MAX_CALLS = 40;
/** The smallest chunk of page worth a call. */
export const MIN_INPUT_CHARS = 1500;

/** Tokens a field's value takes in an answer, by its type. */
export function valueTokens(f: SchemaField): number {
    const base = f.enum ? 6
        : f.type === 'number' || f.type === 'integer' ? 8
            : f.type === 'boolean' ? 4
                : f.type === 'url' || f.type === 'image' ? 40
                    : 30;
    return f.many ? base * 3 : base;
}

/** `"price": {"value": "…", "ref": "b12"}` per field, and the braces. */
export const singleReserve = (fields: SchemaField[]) => 40 + fields.reduce((n, f) => n + 12 + valueTokens(f), 0);

/** `{"ref": "b12", "price": "…", …}` per item. */
export const itemCost = (fields: SchemaField[]) => 10 + fields.reduce((n, f) => n + 4 + valueTokens(f), 0);

export const itemsPerChunk = (fields: SchemaField[]) => Math.max(MIN_ITEMS, Math.min(MAX_ITEMS, Math.floor(LIST_ANSWER_TOKENS / itemCost(fields))));

export const listReserve = (fields: SchemaField[]) => 30 + itemsPerChunk(fields) * itemCost(fields);

const parentOf = (f: SchemaField) => (f.name.includes('__') ? f.name.slice(0, f.name.lastIndexOf('__')) : '');

/**
 * Single answers in calls of at most `MAX_GROUP_FIELDS` fields and `MAX_GROUP_TOKENS` answer tokens,
 * in schema order, siblings together (a parent too big for one call is split).
 */
export function groupFields(fields: SchemaField[], maxFields = MAX_GROUP_FIELDS, maxTokens = MAX_GROUP_TOKENS): SchemaField[][] {
    // Siblings first: runs of fields under the same parent.
    const runs: SchemaField[][] = [];
    for (const f of fields) {
        const last = runs[runs.length - 1];
        if (last && parentOf(last[0]) === parentOf(f) && parentOf(f)) last.push(f);
        else runs.push([f]);
    }
    const groups: SchemaField[][] = [];
    let current: SchemaField[] = [];
    let tokens = 0;
    const flush = () => { if (current.length) groups.push(current); current = []; tokens = 0; };
    for (const run of runs) {
        const cost = run.reduce((n, f) => n + 12 + valueTokens(f), 0);
        if (current.length && (current.length + run.length > maxFields || tokens + cost > maxTokens)) flush();
        for (const f of run) {
            const c = 12 + valueTokens(f);
            if (current.length && (current.length + 1 > maxFields || tokens + c > maxTokens)) flush();
            current.push(f);
            tokens += c;
        }
    }
    flush();
    return groups;
}

const IDENTITY = /(^|_)(name|title|url|link|href|id|sku|asin|code|slug)$/i;

/** The fields that say which item it is: by name, else the first field. At most 3. */
export function identityFields(fields: SchemaField[]): SchemaField[] {
    const named = fields.filter(f => IDENTITY.test(f.name)).slice(0, 3);
    return named.length ? named : fields.slice(0, 1);
}

/** The passes a list is read in: one when the item is narrow, else identity + up to 8 others each. */
export function listPasses(list: SchemaList, maxFields = MAX_GROUP_FIELDS): SchemaList[] {
    if (list.fields.length <= maxFields) return [list];
    const ids = identityFields(list.fields);
    const rest = list.fields.filter(f => !ids.includes(f));
    const per = Math.max(1, maxFields - ids.length);
    const passes: SchemaList[] = [];
    for (let i = 0; i < rest.length; i += per) passes.push({ ...list, fields: [...ids, ...rest.slice(i, i + per)] });
    return passes;
}

/** Characters of page a call can take: the room left after the reserve, the prompt's own text and the constraint. */
export function inputChars(room: { tokens: number; charsPerToken: number }, reserve: number, overheadChars: number, constraintChars: number): number {
    const tokens = room.tokens - reserve - Math.ceil(overheadChars / room.charsPerToken) - Math.ceil(constraintChars / 3);
    return Math.max(MIN_INPUT_CHARS, Math.floor(tokens * room.charsPerToken * 0.9));
}
