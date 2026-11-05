/**
 * Action steps and session setup in the worker (`docs/plans/pro-data-collection-plan.md`, C1): the shared step
 * runner (`../steps/runner.ts`) driving Chromium with Playwright. Each step's target is found in the page with
 * the extension's resolver and acted on with real input: clicks, typing, option choices, keys. Steps run one at a
 * time from here because a step may reload the page (choosing a location usually does), and a script inside the
 * page would not survive it.
 * - After acting, a navigation the step started is waited for, then the page settles.
 * - Dismissals (a consent banner, a promo pop-up) are closed whenever they show: Playwright's locator handlers
 *   close one that gets in the way of a step, and any showing is closed before each read.
 */
import type { Page } from 'playwright';
import { segments } from '../recipe/actions';
import type { Click, PageRecipeSpec, RunSettings, SessionSetup } from '../recipe/types';
import { callInPage, extract, type Session } from './browser';
import type { InPageResult } from './inPage';
import { inPageRequest } from './recipeRun';
import { MARK, type TargetRequest, type TargetResult } from '../steps/inPageSteps';
import * as runner from '../steps/runner';
import { selectorsOf, type StepDriver, type StepOptions } from '../steps/runner';

export { DEFAULT_STEP_OPTIONS, StepFailed, type StepOptions } from '../steps/runner';

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

/** The page as the step runner sees it: found in the page, acted on by Playwright. */
export function playwrightDriver(page: Page, script: string, sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))): StepDriver {
    const settle = async (o: StepOptions) => {
        await page.waitForLoadState('domcontentloaded', { timeout: o.timeoutMs }).catch(() => {});
        if (o.settleMs > 0) await sleep(o.settleMs);
    };
    return {
        find: (request: TargetRequest) => callInPage<TargetResult>(page, script, 'markTarget', [request]),
        isShown: selectors => callInPage<boolean>(page, script, 'isShown', [selectors]),
        async act(c, mark, value, o) {
            const el = page.locator(`[${MARK}="${mark}"]`).first();
            const navigated = page.waitForEvent('framenavigated', { predicate: f => f === page.mainFrame(), timeout: o.navigationWaitMs }).then(() => true, () => false);
            try {
                switch (c.do ?? 'click') {
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
                throw new Error(covered ? `${first} Something may be covering it (a banner or pop-up): add its close control to the dismissals.` : first);
            }
            if (await navigated) await page.waitForLoadState('load', { timeout: o.timeoutMs }).catch(() => {});
            await settle(o);
        },
        async pressKey(key) { await page.keyboard.press(key); },
        async scrollToEnd() { await callInPage(page, script, 'scrollToEnd', [1, 300]); },
        dismissNow: dismiss => dismissNow(page, script, dismiss),
        sleep,
    };
}

type WorkerStepOptions = StepOptions & { sleep?: (ms: number) => Promise<void> };

export function prepareSession(page: Page, script: string, setup: SessionSetup, context: Record<string, string> | undefined, session: Session, o: WorkerStepOptions = runner.DEFAULT_STEP_OPTIONS) {
    return runner.prepareSession(playwrightDriver(page, script, o.sleep), setup, context, session, o);
}

/**
 * A page recipe with Pro's action steps: the runs of fields and plain clicks read by the extractor, the
 * actions between them done by the runner, and the results put together as one read.
 */
export async function extractWithActions(page: Page, script: string, spec: PageRecipeSpec, settings: RunSettings, context: Record<string, string> | undefined, timeoutMs: number,
    o: WorkerStepOptions = runner.DEFAULT_STEP_OPTIONS, dismiss?: Click[]): Promise<InPageResult> {
    const driver = playwrightDriver(page, script, o.sleep);
    const out: InPageResult = { item: {}, steps: [], ways: [] };
    for (const seg of segments(spec)) {
        if (seg.kind === 'read') {
            await dismissNow(page, script, dismiss);
            const r = await extract(page, script, inPageRequest(seg.spec, settings), timeoutMs);
            Object.assign(out.item, r.item);
            out.steps.push(...r.steps);
            out.ways.push(...r.ways);
        } else {
            const r = await runner.runAction(driver, seg.click, context, o);
            out.steps.push({ id: seg.click.id, name: seg.click.name, action: 'click', status: r.status === 'done' ? 'clicked' : 'skipped' } as InPageResult['steps'][number]);
            out.ways.push(...r.ways);
        }
    }
    return out;
}
