/**
 * Time for the waits of a run on a page (a click's answer, an element to appear, the DOM to go quiet).
 *
 * Runs read pages in background tabs, where Chrome throttles the page's timers: aligned to once a
 * second, delayed further once a heavy page spends its background budget, and once a minute after five
 * minutes hidden. A wait built on `setTimeout` there takes many times as long (a COS product page with
 * several clicks stalled until its tab was shown). So:
 *
 * - **`sleep` in a hidden tab is the service worker's**: it asks `RUN_SLEEP`, and the worker answers
 *   after the time on its own timers, which aren't throttled; a message into the tab isn't either. In a
 *   shown tab (the side panel's own runs, tests) it is a plain timer.
 * - **Waits count real time** (`performance.now`) and check on each tick, so a late tick never stretches
 *   them past their limit.
 * - **Each tick also runs the page's animation frames** (`crawlpilot:frame`, heard by `visible-shim.js`),
 *   so an accordion or drawer that animates open finishes while we wait for it.
 */
import { send } from '../../shared/messages';

/** How often a wait looks again. */
const TICK_MS = 100;

const pageTimer = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** This isolated world sees the real visibility (the shim only changes what the page's own scripts see). */
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export async function sleep(ms: number): Promise<void> {
    if (hidden()) {
        // No answer (the worker unreachable, the extension reloaded): the page's timer, never a spin.
        const reply = await send('RUN_SLEEP', { ms }).catch(() => undefined);
        if (!reply?.success) await pageTimer(ms);
        document.dispatchEvent(new CustomEvent('crawlpilot:frame'));
        return;
    }
    await pageTimer(ms);
}

/** Resolves true once `test()` holds, false after `maxMs` (real time). */
export async function until(test: () => boolean, maxMs: number, signal?: AbortSignal): Promise<boolean> {
    const start = performance.now();
    while (!signal?.aborted) {
        if (test()) return true;
        const left = maxMs - (performance.now() - start);
        if (left <= 0) return false;
        await sleep(Math.min(TICK_MS, left));
    }
    return false;
}

/**
 * Resolves once `root` has had no change for `quietMs` (DOM, attributes, text, images finishing), or
 * after `maxMs`, both in real time. `attributes: false` counts only added or removed nodes (a page
 * whose carousel restyles itself forever still goes quiet).
 */
export async function quiet(root: Node, quietMs: number, maxMs: number, options: { signal?: AbortSignal; attributes?: boolean } = {}): Promise<void> {
    let last = performance.now();
    const touch = () => { last = performance.now(); };
    const attributes = options.attributes ?? true;
    const observer = new MutationObserver(touch);
    observer.observe(root, { childList: true, subtree: true, attributes, characterData: attributes });
    root.addEventListener('load', touch, true);
    try {
        const start = performance.now();
        while (!options.signal?.aborted) {
            const now = performance.now();
            if (now - last >= quietMs || now - start >= maxMs) return;
            await sleep(Math.min(TICK_MS, quietMs - (now - last), maxMs - (now - start)));
        }
    } finally {
        observer.disconnect();
        root.removeEventListener('load', touch, true);
    }
}
