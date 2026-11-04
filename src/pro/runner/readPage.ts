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
