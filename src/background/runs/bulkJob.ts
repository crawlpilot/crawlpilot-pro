/** Page Extractor bulk runs: click the recipe's click elements, then extract its elements, on every URL. */
import type { BulkStart } from '../../shared/messages';
import type { RunJob } from './JobRunner';
import { pageSpec } from '../../shared/recipes/spec';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Clicks an element by its selectors (CSS or XPath, in order), in the page's isolated world. Must be
 * self-contained. An element outside the viewport is scrolled into view and reported as 'scroll', so
 * the caller waits and clicks again.
 */
function clickInPage(selectors: string[]) {
    // A control can be on the page twice (a sticky bar's copy): click the first one that is shown.
    const shown = (e: HTMLElement) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    let el: HTMLElement | null = null;
    for (const s of selectors) {
        let found: HTMLElement[] = [];
        try {
            // Runs in the page: `looksLikeXPath` can't be imported, so its rule is repeated here.
            if (/^(\/|\(|\.\/|id\()/.test(s)) {
                const r = document.evaluate(s, document, null, 7, null);
                found = Array.from({ length: r.snapshotLength }, (_, i) => r.snapshotItem(i) as HTMLElement);
            } else {
                found = Array.from(document.querySelectorAll<HTMLElement>(s));
            }
        } catch { /* try the next selector */ }
        el = found.find(shown) ?? found[0] ?? null;
        if (el) break;
    }
    if (!el) return { success: false, error: 'Element not found' };

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { success: false, error: 'Element has zero dimensions' };
    if (!(rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: 'scroll' };
    }
    try {
        el.click();
    } catch {
        el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
    }
    return { success: true };
}

/**
 * Forces collapsible sections open, in the page's MAIN world, after the clicks. Background tabs
 * throttle requestAnimationFrame to ~1fps, so an accordion opened by a click may not have finished
 * animating; inline styles skip the animation. Must be self-contained.
 */
function forceExpandInPage() {
    // SUI React accordion (Home Depot etc.)
    document.querySelectorAll<HTMLElement>('.sui-collapse-root').forEach(el => {
        el.style.setProperty('height', 'auto', 'important');
        el.style.setProperty('min-height', '0', 'important');
        el.style.setProperty('overflow', 'visible', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
    });
    // CSS-checkbox accordions
    document.querySelectorAll<HTMLInputElement>('input.accordion__input[type="checkbox"]').forEach(input => { input.checked = true; });
    // Collapsed accordion regions
    document.querySelectorAll<HTMLElement>('[role="region"][aria-hidden="true"]').forEach(el => {
        el.removeAttribute('aria-hidden');
        el.style.setProperty('display', 'block', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
    });
}

export function bulkJob(start: BulkStart): RunJob {
    const { elements, config } = start;
    if (elements.length === 0) throw new Error('No elements to extract');

    const clicks = elements.filter(e => e.action === 'click');
    const extracts = elements.filter(e => e.action !== 'click');
    const actionSpeed = config.actionSpeed || 500;
    const clickWaitMs = config.clickWaitMs ?? Math.max(actionSpeed, 2000);

    return {
        kind: 'bulk',
        urls: start.urls,
        maxConcurrent: start.maxConcurrent,
        settings: config,
        // Clicks need a focusable window so animations run at full speed.
        interactive: clicks.length > 0,
        jobId: start.jobId,
        name: start.customName,
        spec: pageSpec(elements, config),
        tableType: 'bulk-page',
        columns: found => [
            { id: 'source_url', name: 'Source URL', type: 'url' },
            ...found.filter(c => c.id !== 'source_url' && c.id !== 'recordId'),
            { id: 'recordId', name: 'Record ID', type: 'text' },
        ],

        async extract(tabId, url, ctx) {
            if (clicks.length > 0) {
                for (const el of clicks) {
                    for (let attempt = 0; attempt < 3 && !ctx.stopped(); attempt++) {
                        const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: clickInPage, args: [el.selectors] }).catch(() => []);
                        if ((res?.result as any)?.success !== 'scroll') break;
                        await sleep(1000);
                    }
                }
                // Wait in the service worker (not throttled like the hidden tab) for popups and loaded content.
                if (!ctx.stopped()) await sleep(Math.max(clickWaitMs, 3000));
                if (!ctx.stopped()) {
                    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: forceExpandInPage }).catch(() => undefined);
                }
            }
            if (extracts.length === 0 || ctx.stopped()) return null;

            const response = await ctx.message(tabId, 'CMD_EXTRACT_PAGE_BACKGROUND', {
                url,
                elements: extracts,
                // After clicks, wait (by DOM mutation, not timers) for the elements the clicks reveal.
                config: clicks.length > 0
                    ? { ...config, actionSpeed, waitForElements: true, elementTimeout: Math.max(config.elementTimeout || 0, 8000) }
                    : { ...config, actionSpeed },
            });
            if (!response.success) throw new Error(response.error);
            const { item, items, columns } = response.result;
            const rows = Array.isArray(items) ? items : item ? [item] : [];
            return { rows, columns };
        },
    };
}
