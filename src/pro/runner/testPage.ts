/**
 * Test on this page (`docs/design/LLD.md` §7.1): the recipe runs in the page's tab through the public
 * `extractPage` (the `CMD_EXTRACT_PAGE_BACKGROUND` message bulk runs use), lists nested so each field's
 * value is under its id, then each field is cleaned and checked here.
 * A recipe with a session setup or action steps runs them as the worker does (`../steps/runner.ts`), driving
 * the tab (`tabSteps.ts`): the setup only when its check isn't met already, the actions between the fields,
 * dismissals closed before each read. Variables take the test values given (`context`).
 */
import { sendToTab } from '../../shared/messages';

export { readPageResult, type FieldResult, type PageResult } from './readPage';
import type { StepResult } from '../../shared/listing/stepStats';
import { hasProActions, MissingVariable, segments } from '../recipe/actions';
import { toPageSpec } from '../recipe/fromPublic';
import type { PageRecipeSpec, RunSettings, SessionSetup } from '../recipe/types';
import { DEFAULT_STEP_OPTIONS, prepareSession, runAction, StepFailed } from '../steps/runner';
import { readPageResult, type PageResult } from './readPage';
import { call as callInTab, dismissInTab, tabDriver } from './tabSteps';

/** A setup with something to do. */
export const setupOf = (spec: PageRecipeSpec): SessionSetup | undefined =>
    spec.setup && (spec.setup.steps.length || spec.setup.check || spec.setup.dismiss?.length) ? spec.setup : undefined;

/** Steps in Pro's tab wait less than the worker's: someone is watching. */
const TAB_STEP_OPTIONS = { ...DEFAULT_STEP_OPTIONS, timeoutMs: 8_000, settleMs: 500 };

export function pageTestRequest(spec: PageRecipeSpec, settings: RunSettings, url: string) {
    const { elements } = toPageSpec(spec, settings);
    return { url, elements, config: { ...settings, listOutput: 'nested' as const } };
}

/** The content script starts after a load: a message sent too early finds no one listening. */
const notListening = (e: unknown) => /Receiving end does not exist|Could not establish connection/i.test(e instanceof Error ? e.message : String(e));

/** The public extractor on the tab: the fields' raw values and each step's status. */
async function readOnTab(tabId: number, spec: PageRecipeSpec, settings: RunSettings, url: string): Promise<{ item: Record<string, unknown>; steps: StepResult[] }> {
    for (let tries = 0; ; tries++) {
        try {
            const reply = await sendToTab(tabId, 'CMD_EXTRACT_PAGE_BACKGROUND', pageTestRequest(spec, settings, url));
            if (!reply?.success) throw new Error(reply && 'error' in reply ? String(reply.error) : 'No reply from the page');
            const result = reply.result as { item?: Record<string, unknown>; steps?: StepResult[] };
            return withMarkup(tabId, spec, { item: result.item ?? {}, steps: result.steps ?? [] });
        } catch (e) {
            // After a step loaded a new page, its content script may not be listening yet.
            if (!notListening(e) || tries >= 10) throw e;
            await new Promise(r => setTimeout(r, 300));
        }
    }
}

/** Fields with markup ways read from the page's markup first: a value there is the field's, found in the page's data. */
async function withMarkup(tabId: number, spec: PageRecipeSpec, read: { item: Record<string, unknown>; steps: StepResult[] }) {
    const fields = spec.steps.flatMap(s => s.kind === 'field' && s.field.ways.some(w => w.kind === 'markup')
        ? [{ id: s.field.id, ways: s.field.ways.flatMap(w => w.kind === 'markup' ? [{ source: w.source, key: w.key, ...(w.type ? { type: w.type } : {}) }] : []) }] : []);
    if (!fields.length) return read;
    const hits = await callInTab<Record<string, { value: string }>>(tabId, 'readMarkupFields', [fields]);
    for (const [id, hit] of Object.entries(hits ?? {})) {
        read.item[id] = hit.value;
        const step = read.steps.find(s => s.id === id);
        if (step) step.status = 'data';
    }
    return read;
}

/**
 * Runs the spec on a tab. A page the extension can't reach comes back as an error, not a throw.
 * `context`: test values of the recipe's variables (`{zip}`).
 */
export async function testOnTab(tabId: number, url: string, spec: PageRecipeSpec, settings: RunSettings, context?: Record<string, string>): Promise<PageResult> {
    const setup = setupOf(spec);
    if (!setup && !hasProActions(spec)) {
        try {
            const r = await readOnTab(tabId, spec, settings, url);
            return readPageResult(spec, url, r.item, r.steps);
        } catch (e) {
            return { url, fields: [], clicks: [], error: e instanceof Error ? e.message : String(e) };
        }
    }
    let ran: PageResult['setup'];
    try {
        const driver = tabDriver(tabId, setup?.dismiss);
        if (setup) {
            // The user's tab may be set up already: with a check, the steps run only when it isn't met.
            const run = await prepareSession(driver, setup, context, { prepared: !!setup.check }, TAB_STEP_OPTIONS);
            ran = { ran: run.ran, steps: run.steps };
        }
        const item: Record<string, unknown> = {};
        const steps: StepResult[] = [];
        for (const seg of segments(spec)) {
            if (seg.kind === 'read') {
                await dismissInTab(tabId, setup?.dismiss);
                const r = await readOnTab(tabId, seg.spec, settings, url);
                Object.assign(item, r.item);
                steps.push(...r.steps);
            } else {
                const r = await runAction(driver, seg.click, context, TAB_STEP_OPTIONS);
                steps.push({ id: seg.click.id, name: seg.click.name, action: 'click', status: r.status === 'done' ? 'clicked' : 'skipped' });
            }
        }
        return { ...readPageResult(spec, url, item, steps), ...(ran ? { setup: ran } : {}) };
    } catch (e) {
        const error = e instanceof MissingVariable ? `Give a test value for {${e.name}} first.` : e instanceof Error ? e.message : String(e);
        return { url, fields: [], clicks: [], error, ...(e instanceof StepFailed ? { setup: { ran: true, steps: ran?.steps ?? [], failedStep: e.step } } : ran ? { setup: ran } : {}) };
    }
}

/** Runs only the session setup on the tab, from the start: what Try steps shows. */
export async function trySetupOnTab(tabId: number, spec: PageRecipeSpec, context?: Record<string, string>): Promise<{ ok: boolean; steps: { name: string; status: 'done' | 'skipped' }[]; error?: string; failedStep?: string }> {
    const setup = setupOf(spec);
    if (!setup) return { ok: true, steps: [] };
    const done: { name: string; status: 'done' | 'skipped' }[] = [];
    const driver = tabDriver(tabId, setup.dismiss);
    try {
        await dismissInTab(tabId, setup.dismiss);
        for (const step of setup.steps) {
            const r = await runAction(driver, step, context, TAB_STEP_OPTIONS, `setup:${step.id}`);
            done.push({ name: step.name, status: r.status });
        }
        if (setup.check) {
            // The check, as the runner reads it: a fresh session whose steps already ran.
            await prepareSession(driver, { ...setup, steps: [] }, context, { prepared: false }, TAB_STEP_OPTIONS);
        }
        return { ok: true, steps: done };
    } catch (e) {
        const error = e instanceof MissingVariable ? `Give a test value for {${e.name}} first.` : e instanceof Error ? e.message : String(e);
        return { ok: false, steps: done, error, ...(e instanceof StepFailed ? { failedStep: e.step } : {}) };
    }
}

export function summarize(result: PageResult): { filled: number; ok: number; total: number } {
    return {
        filled: result.fields.filter(f => f.filled).length,
        ok: result.fields.filter(f => f.ok).length,
        total: result.fields.length,
    };
}
