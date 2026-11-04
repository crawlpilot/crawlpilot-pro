/**
 * Action steps and session setup in the worker (`docs/plans/pro-data-collection-plan.md`, C1). Each step's
 * target is found in the page with the extension's resolver (`../steps/inPageSteps.ts`) and acted on with
 * Playwright: real clicks, typing, option choices and keys. Steps run one at a time from here because a step
 * may reload the page (choosing a location usually does), and a script inside the page would not survive it.
 * - A step waits up to its timeout for its target; an optional step whose target never shows is skipped.
 * - After acting, a navigation the step started is waited for, then the page settles.
 * - Session setup runs once per browser session; its check runs on every page, and a session the site has
 *   dropped (an expired cookie) is set up once more. A check still not met fails the attempt: a page is never
 *   read for the wrong location.
 * - Dismissals (a consent banner, a promo pop-up) are closed whenever they show: Playwright's locator handlers
 *   close one that gets in the way of a step, and any showing is closed before each read.
 */
import type { Page } from 'playwright';
import { fillVariables, segments } from '../recipe/actions';
import type { Click, PageRecipeSpec, RunSettings, SessionSetup } from '../recipe/types';
import { callInPage, extract, type Session } from './browser';
import type { InPageResult, WayUse } from './inPage';
import { inPageRequest } from './recipeRun';
import { MARK, type TargetRequest, type TargetResult } from '../steps/inPageSteps';

/** A step or the setup check that could not be done: the attempt is `setup_failed`, naming it. */
export class StepFailed extends Error {
    constructor(readonly step: string, message: string) {
        super(message);
    }
}

export interface StepOptions {
    /** How long a step waits for its target. */
    timeoutMs: number;
    /** An optional step's wait: a banner that would show does so early. */
    optionalWaitMs: number;
    /** After a step: how long a navigation it started has to begin, and the settle after. */
    navigationWaitMs: number;
    settleMs: number;
    sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_STEP_OPTIONS: StepOptions = { timeoutMs: 10_000, optionalWaitMs: 1_000, navigationWaitMs: 1_000, settleMs: 300 };

const POLL_MS = 200;
const selectorsOf = (c: Pick<Click, 'ways'>) => c.ways.flatMap(w => w.kind === 'selector' ? [w.selector] : []);
const wayIdOf = (c: Pick<Click, 'ways'>, i: number, owner: string) => c.ways.filter(w => w.kind === 'selector')[i]?.id ?? `${owner}:${i}`;

let marks = 0;

/** A Playwright locator for a step's selectors: CSS as written, XPath by its prefix, several as alternatives. */
function locatorOf(page: Page, selectors: string[]) {
    const one = (s: string) => page.locator(/^(\/|\(|\.\/|id\()/.test(s) ? `xpath=${s}` : s);
    return selectors.slice(1).reduce((loc, s) => loc.or(one(s)), one(selectors[0]));
}

/** Registers the recipe's dismissals on the page: any that blocks a step is closed, and the step goes on. */
export async function installDismissals(page: Page, dismiss: Click[] | undefined): Promise<void> {
    for (const c of dismiss ?? []) {
        const selectors = selectorsOf(c);
        if (!selectors.length) continue;
        await page.addLocatorHandler(locatorOf(page, selectors).first(), async loc => { await loc.click({ timeout: 2_000 }).catch(() => {}); }, { noWaitAfter: true });
    }
}

/** Closes the dismissals showing now: before reading, so a pop-up never stands over the fields. */
export async function dismissNow(page: Page, script: string, dismiss: Click[] | undefined): Promise<void> {
    for (const c of dismiss ?? []) {
        const selectors = selectorsOf(c);
        if (!selectors.length) continue;
        if (await callInPage<boolean>(page, script, 'isShown', [selectors]).catch(() => false)) {
            await locatorOf(page, selectors).first().click({ timeout: 2_000 }).catch(() => {});
        }
    }
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number, sleep: (ms: number) => Promise<void>): Promise<T | undefined> {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const got = await probe().catch(() => undefined);
        if (got !== undefined) return got;
        if (Date.now() >= end) return undefined;
        await sleep(POLL_MS);
    }
}

/** Runs one action step; its selector usage, and whether it was done or skipped. */
export async function runAction(page: Page, script: string, c: Click, context: Record<string, string> | undefined, o: StepOptions = DEFAULT_STEP_OPTIONS, owner = c.id):
    Promise<{ status: 'done' | 'skipped'; ways: WayUse[] }> {
    const sleep = o.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    const what = c.do ?? 'click';
    const value = c.value !== undefined ? fillVariables(c.value, context) : undefined;
    const selectors = selectorsOf(c);
    const wait = c.optional ? Math.min(o.optionalWaitMs, o.timeoutMs) : o.timeoutMs;
    const fail = (why: string) => new StepFailed(c.name, `Step "${c.name}" (${what}): ${why}`);
    const usage = (r?: TargetResult): WayUse[] => selectors.map((_, i) => ({ wayId: wayIdOf(c, i, owner), tried: true, matched: !!r?.matches[i], won: r?.used === i }));

    // Steps that need no element: a key to the page, a scroll to the end.
    if (selectors.length === 0) {
        if (what === 'press' && value) await page.keyboard.press(value);
        else if (what === 'scroll') await callInPage(page, script, 'scrollToEnd', [1, o.settleMs]);
        else throw fail('it has no element to act on');
        await settle(page, o, sleep);
        return { status: 'done', ways: [] };
    }

    if (what === 'wait') {
        const met = await waitFor(async () => (await callInPage<boolean>(page, script, 'isShown', [selectors])) !== !!c.gone ? true : undefined, wait, sleep);
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
        const r = await callInPage<TargetResult>(page, script, 'markTarget', [request]);
        return r.found ? r : undefined;
    }, wait, sleep);
    if (!target) {
        if (c.optional) return { status: 'skipped', ways: usage() };
        throw fail(what === 'choose' && value !== undefined ? `no item shows "${value}"` : 'its element was not found');
    }

    const el = page.locator(`[${MARK}="${mark}"]`).first();
    const navigated = page.waitForEvent('framenavigated', { predicate: f => f === page.mainFrame(), timeout: o.navigationWaitMs }).then(() => true, () => false);
    try {
        switch (what) {
            case 'click': case 'choose': await el.click({ timeout: o.timeoutMs }); break;
            case 'type':
                await el.fill(value ?? '', { timeout: o.timeoutMs });
                if (c.enter) await el.press('Enter');
                break;
            case 'select': {
                const done = await el.selectOption({ label: value ?? '' }, { timeout: o.timeoutMs }).catch(() => null);
                if (!done?.length) await el.selectOption(value ?? '', { timeout: o.timeoutMs });
                break;
            }
            case 'press': await el.press(value ?? 'Enter', { timeout: o.timeoutMs }); break;
            case 'scroll': await el.scrollIntoViewIfNeeded({ timeout: o.timeoutMs }); break;
        }
    } catch (e) {
        const first = e instanceof Error ? e.message.split('\n')[0] : String(e);
        const covered = e instanceof Error && /intercepts pointer events|Timeout/.test(e.message);
        throw fail(covered ? `${first} Something may be covering it (a banner or pop-up): add its close control to the dismissals.` : first);
    }
    if (await navigated) await page.waitForLoadState('load', { timeout: o.timeoutMs }).catch(() => {});
    await settle(page, o, sleep);
    return { status: 'done', ways: usage(target) };
}

async function settle(page: Page, o: StepOptions, sleep: (ms: number) => Promise<void>) {
    await page.waitForLoadState('domcontentloaded', { timeout: o.timeoutMs }).catch(() => {});
    if (o.settleMs > 0) await sleep(o.settleMs);
}

/** Whether the page shows the setup's check text; and the check's selector usage. */
async function checkMet(page: Page, script: string, setup: SessionSetup, context: Record<string, string> | undefined, waitMs: number, o: StepOptions): Promise<{ met: boolean; ways: WayUse[]; text?: string }> {
    const check = setup.check!;
    const want = fillVariables(check.contains, context).replace(/\s+/g, ' ').trim().toLowerCase();
    const selectors = selectorsOf(check);
    let last: TargetResult | undefined;
    const met = await waitFor(async () => {
        last = await callInPage<TargetResult>(page, script, 'markTarget', [{ selectors, mark: 'check' }]);
        return last.found && (last.text ?? '').toLowerCase().includes(want) ? true : undefined;
    }, waitMs, o.sleep ?? (ms => new Promise(r => setTimeout(r, ms))));
    const ways = selectors.map((_, i) => ({ wayId: wayIdOf(check, i, 'setup:check'), tried: true, matched: !!last?.matches[i], won: last?.used === i }));
    return { met: !!met, ways, ...(last?.text !== undefined ? { text: last.text } : {}) };
}

export interface SetupRun {
    ran: boolean;
    ms: number;
    ways: WayUse[];
}

/**
 * Puts the session in the state the recipe needs: nothing when it already is (the check is met, or there is
 * no check and the setup ran in this session), else the setup's steps and then the check.
 */
export async function prepareSession(page: Page, script: string, setup: SessionSetup, context: Record<string, string> | undefined, session: Session, o: StepOptions = DEFAULT_STEP_OPTIONS): Promise<SetupRun> {
    const started = Date.now();
    await dismissNow(page, script, setup.dismiss);
    if (session.prepared) {
        if (!setup.check) return { ran: false, ms: 0, ways: [] };
        const now = await checkMet(page, script, setup, context, 0, o);
        if (now.met) return { ran: false, ms: Date.now() - started, ways: now.ways };
    }
    session.prepared = false;
    const ways: WayUse[] = [];
    for (const step of setup.steps) ways.push(...(await runAction(page, script, step, context, o, `setup:${step.id}`)).ways);
    if (setup.check) {
        const after = await checkMet(page, script, setup, context, o.timeoutMs, o);
        ways.push(...after.ways);
        if (!after.met) {
            const shown = after.text !== undefined ? `it shows "${after.text.slice(0, 80)}"` : 'its element was not found';
            throw new StepFailed('check', `The setup check is not met: the page should show "${fillVariables(setup.check.contains, context)}", but ${shown}`);
        }
    }
    session.prepared = true;
    return { ran: true, ms: Date.now() - started, ways };
}

/**
 * A page recipe with Pro's action steps: the runs of fields and plain clicks read by the extractor, the
 * actions between them done here, and the results put together as one read.
 */
export async function extractWithActions(page: Page, script: string, spec: PageRecipeSpec, settings: RunSettings, context: Record<string, string> | undefined, timeoutMs: number, o: StepOptions = DEFAULT_STEP_OPTIONS, dismiss?: Click[]): Promise<InPageResult> {
    const out: InPageResult = { item: {}, steps: [], ways: [] };
    for (const seg of segments(spec)) {
        if (seg.kind === 'read') {
            await dismissNow(page, script, dismiss);
            const r = await extract(page, script, inPageRequest(seg.spec, settings), timeoutMs);
            Object.assign(out.item, r.item);
            out.steps.push(...r.steps);
            out.ways.push(...r.ways);
        } else {
            const r = await runAction(page, script, seg.click, context, o);
            out.steps.push({ id: seg.click.id, name: seg.click.name, action: 'click', status: r.status === 'done' ? 'clicked' : 'skipped' } as InPageResult['steps'][number]);
            out.ways.push(...r.ways);
        }
    }
    return out;
}
