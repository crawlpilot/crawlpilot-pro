/**
 * A page's reply read field by field: each field's raw value cleaned and checked (`check.ts`), each click's
 * status. Plain code shared by Pro's tests and the crawler worker, which reads pages the same way.
 */
import type { StepResult, StepStatus } from '../../shared/listing/stepStats';
import type { PageRule, WayHit } from '../../shared/types/ways';
import { readsByWay, toPageSpec } from '../recipe/fromPublic';
import type { PageRecipeSpec, RunSettings } from '../recipe/types';
import { checkField, type FieldCheck } from './check';
import { failsCompare } from '../recipe/valueChecks';
import { joltTransform } from '../recipe/jolt';
import { identityMismatch, pageWays, resolveWays } from './ways';

export interface FieldResult extends FieldCheck {
    fieldId: string;
    name: string;
    /** How the extractor found it: page data, a selector, healed, or not at all. */
    status: StepStatus;
    raw: unknown;
    /** For a field read way by way: the index of the way that gave its value (-1: none). */
    way?: number;
}

export type RuleHit = Pick<PageRule, 'name' | 'status'>;

/** A step's reply: a field read way by way has what each way read. */
export type PageStepReply = StepResult & { hits?: WayHit[] };

export interface PageResult {
    url: string;
    fields: FieldResult[];
    clicks: { name: string; status: StepStatus }[];
    error?: string;
    /** A page rule held: the page is not one the recipe reads, and no field was read. */
    rule?: RuleHit;
    /** The page is another product than its URL names (`PageRecipeSpec.identity`). */
    mismatch?: { expected: string; found: string };
    /** The fields by name turned into the wanted schema (`PageRecipeSpec.transform`), or why that failed. */
    record?: unknown;
    recordError?: string;
    /** A "for each" step's items: each one's label and the fields read for it (`fields` holds the first's). */
    options?: { step: string; label: string; fields: FieldResult[] }[];
    /** The session setup on this page: whether it ran, its steps, and the one that failed. */
    setup?: { ran: boolean; steps: { name: string; status: 'done' | 'skipped' }[]; failedStep?: string };
}

/** The extractor's elements for a page recipe: fields read way by way carry their ways, and the page rules go with the settings. */
export function pageRequest(spec: PageRecipeSpec, settings: RunSettings) {
    const { elements } = toPageSpec(spec, settings);
    const ways = new Map(spec.steps.flatMap(s => s.kind === 'field' && readsByWay(s.field) ? [[s.field.id, pageWays(s.field)] as const] : []));
    return {
        elements: elements.map(e => ways.has(e.id) ? { ...e, ways: ways.get(e.id) } : e),
        config: { ...settings, listOutput: 'nested' as const, ...(spec.rules?.length ? { pageRules: spec.rules } : {}) },
    };
}

/** The reply of one page, read field by field. */
export function readPageResult(spec: PageRecipeSpec, url: string, item: Record<string, unknown>, steps: PageStepReply[] = [], rule?: RuleHit | null): PageResult {
    if (rule) return { url, fields: [], clicks: [], rule };
    const byId = new Map(steps.map(s => [s.id, s]));
    const fields: FieldResult[] = [];
    const clicks: PageResult['clicks'] = [];
    for (const step of spec.steps) {
        if (step.kind === 'click') { clicks.push({ name: step.click.name, status: byId.get(step.click.id)?.status ?? 'not-found' }); continue; }
        const { field } = step;
        const hits = byId.get(field.id)?.hits;
        if (hits) {
            const { raw, won } = resolveWays(field, hits, url);
            const status: StepStatus = won < 0 ? 'not-found' : field.ways[won].kind === 'data' ? 'data' : 'ok';
            fields.push({ fieldId: field.id, name: field.name, status, raw, way: won, ...checkField(field, raw, url) });
            continue;
        }
        const raw = item[field.id] ?? null;
        fields.push({ fieldId: field.id, name: field.name, status: byId.get(field.id)?.status ?? 'not-found', raw, ...checkField(field, raw, url) });
    }
    compareFields(spec, fields);
    const mismatch = spec.identity ? identityMismatch(spec.identity, url, fields.find(f => f.name === spec.identity!.field)?.cleaned) : undefined;
    return { url, fields, clicks, ...(mismatch ? { mismatch } : {}), ...transformed(spec, recordOf(fields)) };
}

/** A page's fields by name, as read (typed, cleaned): what the transform starts from. */
export const recordOf = (fields: Pick<FieldResult, 'name' | 'value'>[]): Record<string, unknown> =>
    Object.fromEntries(fields.map(f => [f.name, f.value ?? null]));

/** The record through the recipe's JOLT chain; nothing when it has none. */
export function transformed(spec: PageRecipeSpec, record: Record<string, unknown>): { record?: unknown; recordError?: string } {
    if (!spec.transform?.jolt.length) return {};
    try {
        return { record: joltTransform(record, spec.transform.jolt) };
    } catch (e) {
        return { recordError: e instanceof Error ? e.message : String(e) };
    }
}

/** Each field's comparisons with another field on the page, once all are read: a failed one is the field's problem. */
function compareFields(spec: PageRecipeSpec, fields: FieldResult[]) {
    const byName = new Map(fields.map(f => [f.name, f]));
    for (const step of spec.steps) {
        if (step.kind !== 'field' || !step.field.checks?.some(c => c.kind === 'compare')) continue;
        const r = fields.find(f => f.fieldId === step.field.id);
        if (!r?.ok || !r.filled) continue;
        for (const c of step.field.checks) {
            if (c.kind !== 'compare') continue;
            const other = byName.get(c.field);
            if (!other?.filled || !other.ok) continue;
            const problem = failsCompare(c, r.value, other.value);
            if (problem) { r.ok = false; r.problem = problem; break; }
        }
    }
}

/**
 * A page read with its steps: the fields with the first item's values, and, for a "for each" step, each item's own
 * fields (those it repeats) with that item's values.
 */
export function readStepsResult(spec: PageRecipeSpec, url: string, r: { item: Record<string, unknown>; steps: PageStepReply[]; rule?: RuleHit; options?: { step: string; label: string; item: Record<string, unknown> }[] }): PageResult {
    const first = r.options?.[0];
    const page = readPageResult(spec, url, { ...r.item, ...first?.item }, r.steps, r.rule);
    if (!r.options || page.rule) return page;
    return {
        ...page,
        options: r.options.map(o => ({
            step: o.step, label: o.label,
            fields: readPageResult(spec, url, { ...r.item, ...o.item }, r.steps).fields.filter(f => f.fieldId in o.item),
        })),
    };
}
