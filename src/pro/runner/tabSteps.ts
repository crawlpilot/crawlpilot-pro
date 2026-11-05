/**
 * The step runner (`src/pro/steps/runner.ts`) driving the user's tab, for Test on this page, Test on sample
 * pages and Try steps. The step script (`src/pro/steps/contentSteps.ts`) is injected when first needed and again
 * after a step loads a new page; each call runs in the extension's isolated world, as content scripts do.
 */
import stepsScript from '../steps/contentSteps?script';
import type { TargetRequest, TargetResult } from '../steps/inPageSteps';
import type { ActRequest } from '../steps/contentSteps';
import { selectorsOf, type StepDriver, type StepOptions } from '../steps/runner';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Until the tab has loaded, at most `timeoutMs`. */
async function settled(tabId: number, timeoutMs: number): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab || tab.status === 'complete') return;
        await sleep(150);
    }
}

async function present(tabId: number): Promise<boolean> {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => typeof (globalThis as { crawlpilotSteps?: unknown }).crawlpilotSteps === 'object' });
    return r?.result === true;
}

/** The step script in the tab: injected when it isn't there (a new page), and waited for. */
async function ensure(tabId: number): Promise<void> {
    await settled(tabId, 15_000);
    if (await present(tabId).catch(() => false)) return;
    await chrome.scripting.executeScript({ target: { tabId }, files: [stepsScript] });
    for (let i = 0; i < 50; i++) {
        if (await present(tabId).catch(() => false)) return;
        await sleep(100);
    }
    throw new Error('The step script did not start in the page');
}

/** Calls the step script; a page that navigated in between is waited for and the script injected again. */
export async function call<T>(tabId: number, name: string, args: unknown[]): Promise<T> {
    for (let tries = 0; ; tries++) {
        try {
            await ensure(tabId);
            const [r] = await chrome.scripting.executeScript({
                target: { tabId },
                func: (n: string, a: unknown[]) => (globalThis as unknown as { crawlpilotSteps: Record<string, (...x: unknown[]) => unknown> }).crawlpilotSteps[n](...a),
                args: [name, args],
            });
            return r?.result as T;
        } catch (e) {
            if (tries >= 3) throw e;
            await sleep(300);
        }
    }
}

/** Closes the dismissals showing in the tab now. */
export async function dismissInTab(tabId: number, dismiss: Parameters<StepDriver['dismissNow']>[0]): Promise<void> {
    for (const c of dismiss ?? []) {
        const selectors = selectorsOf(c);
        if (!selectors.length || !await call<boolean>(tabId, 'isShown', [selectors]).catch(() => false)) continue;
        const target = await call<TargetResult>(tabId, 'markTarget', [{ selectors, mark: `dismiss-${c.id}` }]);
        if (target.found) await call(tabId, 'act', [{ mark: `dismiss-${c.id}`, do: 'click' } satisfies ActRequest]).catch(() => {});
        await sleep(200);
    }
}

export function tabDriver(tabId: number, dismiss?: Parameters<StepDriver['dismissNow']>[0]): StepDriver {
    return {
        find: (request: TargetRequest) => call<TargetResult>(tabId, 'markTarget', [request]),
        isShown: selectors => call<boolean>(tabId, 'isShown', [selectors]),
        async act(c, mark, value, o: StepOptions) {
            // Dismissals first: a pop-up over the target would take the click.
            await dismissInTab(tabId, dismiss);
            const what = c.do ?? 'click';
            const r = await call<{ ok: boolean; error?: string }>(tabId, 'act', [{ mark, do: what === 'wait' ? 'scroll' : what, ...(value !== undefined ? { value } : {}), ...(c.enter ? { enter: true } : {}) } satisfies ActRequest]);
            if (!r?.ok) throw new Error(r?.error ?? 'it could not be used');
            // A step that loads a page: give it time to start, then wait for it.
            await sleep(o.navigationWaitMs);
            await settled(tabId, o.timeoutMs);
            if (o.settleMs > 0) await sleep(o.settleMs);
        },
        async pressKey(key) { await call(tabId, 'pressKey', [key]); },
        async scrollToEnd() { await call(tabId, 'scrollToEnd', []); await sleep(300); },
        dismissNow: d => dismissInTab(tabId, d),
        sleep,
    };
}
