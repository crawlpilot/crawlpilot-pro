/**
 * Test on this page (`docs/design/LLD.md` §7.1): the recipe runs in the page's tab through the public
 * `extractPage` (the `CMD_EXTRACT_PAGE_BACKGROUND` message bulk runs use), lists nested so each field's
 * value is under its id, then each field is cleaned and checked here.
 */
import { sendToTab } from '../../shared/messages';
import type { StepResult, StepStatus } from '../../shared/listing/stepStats';
import { toPageSpec } from '../recipe/fromPublic';
import type { PageRecipeSpec, RunSettings } from '../recipe/types';
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
}

export function pageTestRequest(spec: PageRecipeSpec, settings: RunSettings, url: string) {
    const { elements } = toPageSpec(spec, settings);
    return { url, elements, config: { ...settings, listOutput: 'nested' as const } };
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

/** Runs the spec on a tab. A page the extension can't reach comes back as an error, not a throw. */
export async function testOnTab(tabId: number, url: string, spec: PageRecipeSpec, settings: RunSettings): Promise<PageResult> {
    try {
        const reply = await sendToTab(tabId, 'CMD_EXTRACT_PAGE_BACKGROUND', pageTestRequest(spec, settings, url));
        if (!reply?.success) return { url, fields: [], clicks: [], error: reply && 'error' in reply ? String(reply.error) : 'No reply from the page' };
        const result = reply.result as { item?: Record<string, unknown>; steps?: StepResult[] };
        return readPageResult(spec, url, result.item ?? {}, result.steps);
    } catch (e) {
        return { url, fields: [], clicks: [], error: e instanceof Error ? e.message : String(e) };
    }
}

export function summarize(result: PageResult): { filled: number; ok: number; total: number } {
    return {
        filled: result.fields.filter(f => f.filled).length,
        ok: result.fields.filter(f => f.ok).length,
        total: result.fields.length,
    };
}
