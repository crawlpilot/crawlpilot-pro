/**
 * Pro's step runner (`docs/plans/pro-data-collection-plan.md`, C1), the same in the worker and in Pro's tests:
 * what a step waits for, when an optional one is skipped, how a session is set up and checked, and what each
 * step's selectors count for selector usage. Where it runs is a driver's business:
 * - the worker drives Chromium with Playwright: real input events, navigations waited for
 *   (`src/pro/crawler/steps.ts`);
 * - Pro drives the user's tab through an injected script (`src/pro/runner/tabSteps.ts`).
 * A step's target is found in the page by `inPageSteps.ts` (the extension's own resolver, visible elements
 * only), marked, and acted on by the driver.
 */
import { fillVariables, MAX_EACH, segments } from '../recipe/actions';
import type { Click, PageRecipeSpec, SessionSetup } from '../recipe/types';
import type { StepResult } from '../../shared/listing/stepStats';
import type { PageRule } from '../../shared/types/ways';
import type { TargetRequest, TargetResult } from './inPageSteps';

/** A step or the setup check that could not be done: the attempt fails, naming it. */
export class StepFailed extends Error {
    constructor(readonly step: string, message: string) {
        super(message);
    }
}

/** One way's use on a page, as selector usage counts it. */
export interface StepWayUse {
    wayId: string;
    tried: boolean;
    matched: boolean;
    won: boolean;
}

export interface StepOptions {
    /** How long a step waits for its target. */
    timeoutMs: number;
    /** An optional step's wait: what would show does so early. */
    optionalWaitMs: number;
    /** After a step: how long a navigation it started has to begin, and the settle after. */
    navigationWaitMs: number;
    settleMs: number;
}

export const DEFAULT_STEP_OPTIONS: StepOptions = { timeoutMs: 10_000, optionalWaitMs: 1_000, navigationWaitMs: 1_000, settleMs: 300 };

/** What a page can do for the runner. */
export interface StepDriver {
    find(request: TargetRequest): Promise<TargetResult>;
    isShown(selectors: string[]): Promise<boolean>;
    /** The visible items' texts: what a "for each" step goes through. */
    listItems(selectors: string[]): Promise<string[]>;
    /** Acts on the marked target; throws with a reason when it can't. Waits for a navigation it caused. */
    act(c: Click, mark: string, value: string | undefined, o: StepOptions): Promise<void>;
    /** A key to the page, with no target. */
    pressKey(key: string): Promise<void>;
    /** To the end of the page, with no target. */
    scrollToEnd(): Promise<void>;
    /** Closes the dismissals showing now. */
    dismissNow(dismiss: Click[] | undefined): Promise<void>;
    sleep(ms: number): Promise<void>;
}

const POLL_MS = 200;
export const selectorsOf = (c: Pick<Click, 'ways'>) => c.ways.flatMap(w => w.kind === 'selector' ? [w.selector] : []);
const wayIdOf = (c: Pick<Click, 'ways'>, i: number, owner: string) => c.ways.filter(w => w.kind === 'selector')[i]?.id ?? `${owner}:${i}`;

let marks = 0;

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number, sleep: (ms: number) => Promise<void>): Promise<T | undefined> {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const got = await probe().catch(() => undefined);
        if (got !== undefined) return got;
        if (Date.now() >= end) return undefined;
        await sleep(POLL_MS);
    }
}

/** Runs one action step: done or skipped, and its selector usage. Throws `StepFailed`. */
export async function runAction(d: StepDriver, c: Click, context: Record<string, string> | undefined, o: StepOptions = DEFAULT_STEP_OPTIONS, owner = c.id):
    Promise<{ status: 'done' | 'skipped'; ways: StepWayUse[] }> {
    const what = c.do ?? 'click';
    const value = c.value !== undefined ? fillVariables(c.value, context) : undefined;
    const selectors = selectorsOf(c);
    const wait = c.optional ? Math.min(o.optionalWaitMs, o.timeoutMs) : o.timeoutMs;
    const fail = (why: string) => new StepFailed(c.name, `Step "${c.name}" (${what}): ${why}`);
    const usage = (r?: TargetResult): StepWayUse[] => selectors.map((_, i) => ({ wayId: wayIdOf(c, i, owner), tried: true, matched: !!r?.matches[i], won: r?.used === i }));

    // Steps that need no element: a key to the page, a scroll to the end.
    if (selectors.length === 0) {
        if (what === 'press' && value) await d.pressKey(value);
        else if (what === 'scroll') await d.scrollToEnd();
        else throw fail('it has no element to act on');
        return { status: 'done', ways: [] };
    }

    if (what === 'wait') {
        const met = await waitFor(async () => (await d.isShown(selectors)) !== !!c.gone ? true : undefined, wait, ms => d.sleep(ms));
        if (!met) {
            if (c.optional) return { status: 'skipped', ways: usage() };
            throw fail(c.gone ? 'it did not go away in time' : 'it did not appear in time');
        }
        return { status: 'done', ways: [] };
    }

    const mark = `m${++marks}`;
    const request: TargetRequest = {
        selectors, mark,
        ...(what === 'choose' ? { choose: value !== undefined ? { text: value } : { index: c.index ?? 0 } } : {}),
    };
    const target = await waitFor(async () => {
        const r = await d.find(request);
        return r.found ? r : undefined;
    }, wait, ms => d.sleep(ms));
    if (!target) {
        if (c.optional) return { status: 'skipped', ways: usage() };
        throw fail(what === 'choose' && value !== undefined ? `no item shows "${value}"` : 'its element was not found');
    }
    try {
        await d.act(c, mark, value, o);
    } catch (e) {
        throw fail(e instanceof Error ? e.message : String(e));
    }
    return { status: 'done', ways: usage(target) };
}

/** Whether the page shows the setup's check text; and the check's selector usage. */
async function checkMet(d: StepDriver, setup: SessionSetup, context: Record<string, string> | undefined, waitMs: number): Promise<{ met: boolean; ways: StepWayUse[]; text?: string }> {
    const check = setup.check!;
    const want = fillVariables(check.contains, context).replace(/\s+/g, ' ').trim().toLowerCase();
    const selectors = selectorsOf(check);
    let last: TargetResult | undefined;
    const met = await waitFor(async () => {
        last = await d.find({ selectors, mark: 'check' });
        return last.found && (last.text ?? '').toLowerCase().includes(want) ? true : undefined;
    }, waitMs, ms => d.sleep(ms));
    const ways = selectors.map((_, i) => ({ wayId: wayIdOf(check, i, 'setup:check'), tried: true, matched: !!last?.matches[i], won: last?.used === i }));
    return { met: !!met, ways, ...(last?.text !== undefined ? { text: last.text } : {}) };
}

/** A browser session's own state: whether a recipe's session setup has run in it. */
export interface Session { prepared: boolean }

export interface SetupRun {
    ran: boolean;
    ms: number;
    ways: StepWayUse[];
    /** Each step, as it went: for Pro to show. */
    steps: { name: string; status: 'done' | 'skipped' }[];
}

/**
 * Puts the session in the state the recipe needs: nothing when it already is (the check is met, or there is
 * no check and the setup ran in this session), else the setup's steps and then the check. A check not met
 * after the steps throws `StepFailed('check')`: a page is never read for the wrong location.
 */
export async function prepareSession(d: StepDriver, setup: SessionSetup, context: Record<string, string> | undefined, session: Session, o: StepOptions = DEFAULT_STEP_OPTIONS): Promise<SetupRun> {
    const started = Date.now();
    await d.dismissNow(setup.dismiss);
    if (session.prepared) {
        if (!setup.check) return { ran: false, ms: 0, ways: [], steps: [] };
        const now = await checkMet(d, setup, context, 0);
        if (now.met) return { ran: false, ms: Date.now() - started, ways: now.ways, steps: [] };
    }
    session.prepared = false;
    const ways: StepWayUse[] = [];
    const steps: SetupRun['steps'] = [];
    for (const step of setup.steps) {
        const r = await runAction(d, step, context, o, `setup:${step.id}`);
        ways.push(...r.ways);
        steps.push({ name: step.name, status: r.status });
    }
    if (setup.check) {
        const after = await checkMet(d, setup, context, o.timeoutMs);
        ways.push(...after.ways);
        if (!after.met) {
            const shown = after.text !== undefined ? `it shows "${after.text.slice(0, 80)}"` : 'its element was not found';
            throw new StepFailed('check', `The setup check is not met: the page should show "${fillVariables(setup.check.contains, context)}", but ${shown}`);
        }
    }
    session.prepared = true;
    return { ran: true, ms: Date.now() - started, ways, steps };
}

/** What reading a run of fields gives: values by field id, each step's status, and selector usage. */
export interface SegmentRead {
    item: Record<string, unknown>;
    steps: StepResult[];
    ways: StepWayUse[];
    /** A page rule held (`PageRecipeSpec.rules`): the page is not one the recipe reads. */
    rule?: Pick<PageRule, 'name' | 'status'>;
}

/** A page read with its steps: the values, and one row of values per item a "for each" step went through. */
export interface StepsRead extends SegmentRead {
    /** The "for each" step's items, in order: each one's label and the values read for it. */
    options?: { step: string; label: string; item: Record<string, unknown> }[];
}

/**
 * A page recipe with Pro's steps: runs of fields read by `read` (the extractor), actions done between them, and a
 * "for each" step's fields read once per item. Dismissals are closed before each read. Selector usage comes from
 * the first time through.
 */
export async function runPageSteps(d: StepDriver, spec: PageRecipeSpec, context: Record<string, string> | undefined, o: StepOptions,
    read: (spec: PageRecipeSpec) => Promise<SegmentRead>, dismiss?: Click[]): Promise<StepsRead> {
    const out: StepsRead = { item: {}, steps: [], ways: [] };
    const stepResult = (c: Click, status: 'done' | 'skipped'): StepResult => ({ id: c.id, name: c.name, action: 'click', status: status === 'done' ? 'clicked' : 'skipped' });
    const readInto = async (s: PageRecipeSpec, into: SegmentRead) => {
        await d.dismissNow(dismiss);
        const r = await read(s);
        Object.assign(into.item, r.item);
        into.steps.push(...r.steps);
        into.ways.push(...r.ways);
        if (r.rule && !out.rule) out.rule = r.rule;
    };
    for (const seg of segments(spec)) {
        // A page rule held: the page is not one to read, nor to act on.
        if (out.rule) break;
        if (seg.kind === 'read') await readInto(seg.spec, out);
        else if (seg.kind === 'act') {
            const r = await runAction(d, seg.click, context, o);
            out.steps.push(stepResult(seg.click, r.status));
            out.ways.push(...r.ways);
        } else {
            const { click } = seg;
            const each = click.forEach!;
            const selectors = selectorsOf(click);
            const max = each.max ?? MAX_EACH;
            const labels = each.values?.length ? each.values.map(v => fillVariables(v, context)) : (await d.listItems(selectors)).filter(Boolean);
            if (!labels.length) {
                if (click.optional) { out.steps.push(stepResult(click, 'skipped')); continue; }
                throw new StepFailed(click.name, `Step "${click.name}" (for each): no items to choose from`);
            }
            out.options = [];
            for (const [i, label] of labels.slice(0, max).entries()) {
                // By its text when the items are named, else by place: items listed from the page keep their order.
                const one: Click = { ...click, forEach: undefined, ...(each.values?.length ? { value: label } : { value: undefined, index: i }) };
                const r = await runAction(d, one, context, o);
                const row: SegmentRead = { item: {}, steps: [], ways: [] };
                await readInto(seg.spec, row);
                out.options.push({ step: click.name, label, item: row.item });
                if (i === 0) {
                    out.steps.push(stepResult(click, r.status), ...row.steps);
                    out.ways.push(...r.ways, ...row.ways);
                }
            }
        }
    }
    return out;
}
