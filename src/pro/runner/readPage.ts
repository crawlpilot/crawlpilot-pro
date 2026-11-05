/**
 * A page's reply read field by field: each field's raw value cleaned and checked (`check.ts`), each click's
 * status. Plain code shared by Pro's tests and the crawler worker, which reads pages the same way.
 */
import type { StepResult, StepStatus } from '../../shared/listing/stepStats';
import type { PageRecipeSpec } from '../recipe/types';
import { checkField, type FieldCheck } from './check';

export interface FieldResult extends FieldCheck {
    fieldId: string;
    name: string;
    /** How the extractor found it: page data, a selector, healed, or not at all. */
    status: StepStatus;
    raw: unknown;
}

export interface PageResult {
    url: string;
    fields: FieldResult[];
    clicks: { name: string; status: StepStatus }[];
    error?: string;
    /** A "for each" step's items: each one's label and the fields read for it (`fields` holds the first's). */
    options?: { step: string; label: string; fields: FieldResult[] }[];
    /** The session setup on this page: whether it ran, its steps, and the one that failed. */
    setup?: { ran: boolean; steps: { name: string; status: 'done' | 'skipped' }[]; failedStep?: string };
}

/** The reply of one page, read field by field. */
export function readPageResult(spec: PageRecipeSpec, url: string, item: Record<string, unknown>, steps: StepResult[] = []): PageResult {
    const status = new Map(steps.map(s => [s.id, s.status]));
    const fields: FieldResult[] = [];
    const clicks: PageResult['clicks'] = [];
    for (const step of spec.steps) {
        if (step.kind === 'click') { clicks.push({ name: step.click.name, status: status.get(step.click.id) ?? 'not-found' }); continue; }
        const { field } = step;
        const raw = item[field.id] ?? null;
        fields.push({ fieldId: field.id, name: field.name, status: status.get(field.id) ?? 'not-found', raw, ...checkField(field, raw, url) });
    }
    return { url, fields, clicks };
}

/**
 * A page read with its steps: the fields with the first item's values, and, for a "for each" step, each item's own
 * fields (those it repeats) with that item's values.
 */
export function readStepsResult(spec: PageRecipeSpec, url: string, r: { item: Record<string, unknown>; steps: StepResult[]; options?: { step: string; label: string; item: Record<string, unknown> }[] }): PageResult {
    const first = r.options?.[0];
    const page = readPageResult(spec, url, { ...r.item, ...first?.item }, r.steps);
    if (!r.options) return page;
    return {
        ...page,
        options: r.options.map(o => ({
            step: o.step, label: o.label,
            fields: readPageResult(spec, url, { ...r.item, ...o.item }, r.steps).fields.filter(f => f.fieldId in o.item),
        })),
    };
}
