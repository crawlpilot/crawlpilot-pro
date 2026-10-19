/**
 * Prompt, constrained response schema and output parsing for schema extraction with Chrome's
 * on-device model. Each field comes back as {value, ref}: the value copied from the page and the
 * [eN] reference of the line it was read from, so every value can be checked against the page.
 */
import type { SchemaField } from './schemaIntake';

export interface FieldAnswer {
    value: string;
    ref: string;
}

export const EXTRACT_SYSTEM_PROMPT =
    'You extract data from a web page. The page is given as lines that start with a reference like [e12]. ' +
    'For each requested field, copy the value exactly as it is written on the page and give the reference of the line it came from. ' +
    'If the page does not show the field, use an empty string for both value and ref. Never guess, compute or reformat values.';

/** JSON Schema for `responseConstraint`: every field required, no extra keys. */
export function buildResponseSchema(fields: SchemaField[]): object {
    const properties: Record<string, object> = {};
    for (const f of fields) {
        properties[f.name] = {
            type: 'object',
            // A ref is a line reference or empty; `relax` drops the pattern if Chrome can't enforce it.
            properties: { value: { type: 'string' }, ref: { type: 'string', pattern: '^(e[0-9]+)?$' } },
            required: ['value', 'ref'],
            additionalProperties: false,
        };
    }
    return { type: 'object', properties, required: fields.map(f => f.name), additionalProperties: false };
}

export function buildExtractPrompt(view: string, fields: SchemaField[]): string {
    const list = fields.map(f => {
        const hint = f.type === 'image' ? ' (an image: give its line)' : f.type === 'url' ? ' (a link: give its line)' : '';
        return `- ${f.name}${f.description ? `: ${f.description}` : ''}${hint}`;
    }).join('\n');
    return `Page:\n---\n${view}\n---\n\nFields to extract:\n${list}\n\nAnswer with a JSON object with one key per field; each value is {"value": "...", "ref": "eN"}.`;
}

/** Tolerant parse: accepts the constrained JSON, JSON wrapped in prose or code fences, and bare strings. */
export function parseModelOutput(text: string, fields: SchemaField[]): Record<string, FieldAnswer> {
    let obj: any = undefined;
    const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try { obj = JSON.parse(trimmed); } catch {
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try { obj = JSON.parse(trimmed.slice(start, end + 1)); } catch { obj = undefined; }
        }
    }
    const out: Record<string, FieldAnswer> = {};
    for (const f of fields) {
        const v = obj?.[f.name];
        if (v && typeof v === 'object') {
            out[f.name] = { value: String(v.value ?? '').trim(), ref: String(v.ref ?? '').trim().replace(/^\[|\]$/g, '') };
        } else if (typeof v === 'string' || typeof v === 'number') {
            out[f.name] = { value: String(v).trim(), ref: '' };
        } else {
            out[f.name] = { value: '', ref: '' };
        }
    }
    return out;
}

function norm(s: string): string {
    return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Whether a value the model returned is really in the element text it pointed to. Exact containment
 * after normalising whitespace and case; short element texts may be contained in a longer value only
 * when they make up most of it (the model added a word or two of context).
 */
export function isGrounded(value: string, elementText: string): boolean {
    const v = norm(value);
    const t = norm(elementText);
    if (!v || !t) return false;
    if (t.includes(v)) return true;
    return v.includes(t) && t.length >= v.length * 0.7;
}
