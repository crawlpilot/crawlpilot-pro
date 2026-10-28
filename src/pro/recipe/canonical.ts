/**
 * Canonical form and digests (`docs/design/LLD.md` §4). Key order never matters, ids (and a way's
 * `addedIn`) are identity rather than meaning, and selectors are compared with their whitespace collapsed. The digest covers the spec
 * only, so a change of pace or pages keeps it; `outputDigest` covers what consumers see.
 */
import type { FieldType, ProSpec, Step } from './types';

const IDENTITY = new Set(['id', 'addedIn']);

function canonicalValue(value: unknown, key?: string): unknown {
    if (Array.isArray(value)) return value.map(v => canonicalValue(v));
    if (value && typeof value === 'object') {
        const entries = Object.keys(value as object)
            .filter(k => !IDENTITY.has(k) && (value as Record<string, unknown>)[k] !== undefined)
            .sort()
            .map(k => [k, canonicalValue((value as Record<string, unknown>)[k], k)]);
        return Object.fromEntries(entries);
    }
    if (typeof value === 'string' && key === 'selector') return value.replace(/\s+/g, ' ').trim();
    return value;
}

/** The spec as canonical JSON. */
export function canonicalJson(spec: ProSpec): string {
    return canonicalString(spec);
}

/** Any part of a spec as canonical JSON. */
export function canonicalString(value: unknown): string {
    return JSON.stringify(canonicalValue(value));
}

async function sha256(text: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function specDigest(spec: ProSpec): Promise<string> {
    return sha256(canonicalJson(spec));
}

/** The fields a version outputs, in order: name, type, required. A list recipe's are its columns. */
export function outputFields(spec: ProSpec): [string, FieldType | string, boolean][] {
    if (spec.kind === 'page') return pageOutput(spec.steps);
    const fields: [string, string, boolean][] = spec.lists.flatMap(l => l.fields.map(c => [c.name, c.type, false] as [string, string, boolean]));
    return spec.details ? [...fields, ...pageOutput(spec.details.spec.steps)] : fields;
}

function pageOutput(steps: Step[]): [string, FieldType, boolean][] {
    return steps.flatMap(s => s.kind === 'field' ? [[s.field.name, s.field.type, !!s.field.required] as [string, FieldType, boolean]] : []);
}

export function outputDigest(spec: ProSpec): Promise<string> {
    return sha256(JSON.stringify(outputFields(spec)));
}
