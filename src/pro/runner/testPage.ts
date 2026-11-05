/**
 * Test on this page (`docs/design/LLD.md` §7.1): the recipe runs in the page's tab through the public
 * `extractPage` (the `CMD_EXTRACT_PAGE_BACKGROUND` message bulk runs use), lists nested so each field's
 * value is under its id, then each field is cleaned and checked here.
 */
import { sendToTab } from '../../shared/messages';
import type { StepResult, StepStatus } from '../../shared/listing/stepStats';
import type { PageRule, WayHit } from '../../shared/types/ways';
import { readsByWay, toPageSpec } from '../recipe/fromPublic';
import type { PageRecipeSpec, RunSettings } from '../recipe/types';
import { checkField, type FieldCheck } from './check';
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

export interface PageResult {
    url: string;
    fields: FieldResult[];
    clicks: { name: string; status: StepStatus }[];
    error?: string;
    /** A page rule held: the page is not one the recipe reads, and no field was read. */
    rule?: RuleHit;
    /** The page is another product than its URL names (`PageRecipeSpec.identity`). */
    mismatch?: { expected: string; found: string };
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

export function pageTestRequest(spec: PageRecipeSpec, settings: RunSettings, url: string) {
    return { url, ...pageRequest(spec, settings) };
}

export type PageStepReply = StepResult & { hits?: WayHit[] };

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
    const mismatch = spec.identity ? identityMismatch(spec.identity, url, fields.find(f => f.name === spec.identity!.field)?.cleaned) : undefined;
    return { url, fields, clicks, ...(mismatch ? { mismatch } : {}) };
}

/** Runs the spec on a tab. A page the extension can't reach comes back as an error, not a throw. */
export async function testOnTab(tabId: number, url: string, spec: PageRecipeSpec, settings: RunSettings): Promise<PageResult> {
    try {
        const reply = await sendToTab(tabId, 'CMD_EXTRACT_PAGE_BACKGROUND', pageTestRequest(spec, settings, url));
        if (!reply?.success) return { url, fields: [], clicks: [], error: reply && 'error' in reply ? String(reply.error) : 'No reply from the page' };
        const result = reply.result as { item?: Record<string, unknown>; steps?: PageStepReply[]; rule?: RuleHit };
        return readPageResult(spec, url, result.item ?? {}, result.steps, result.rule);
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
