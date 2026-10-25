import { quiet } from './clock';
/**
 * Waiting for a page to finish what it started (`docs/plans/list-extraction-reliability-plan.md` L2):
 * quiet for `quietMs` (no DOM changes, no images finishing), at most `maxMs`. A fixed delay is too
 * short on a slow site and wasted on a fast one. Timed by `clock.ts`, so it holds in a hidden tab.
 */
export function settle(root: Node = document.body, quietMs = 300, maxMs = 2000, signal?: AbortSignal): Promise<void> {
    // On the run's clock: a hidden tab's own timers would stretch this wait many times over.
    return quiet(root, quietMs, maxMs, { signal });
}

/** Text of a control that loads more of the list: "Show more", "Load more results", "See more products". */
const MORE = /^(show|load|see|view)\s+(\d+\s+)?more(\s+(results|items|products|listings|posts))?\b/i;

/**
 * The page's own "Show more" / "Load more" control for `list`: a visible button or link (or a
 * `data-*show-more*` / `data-*load-more*` hook) inside the list or after it, nearest first.
 */
export function findLoadMore(list: Element): HTMLElement | null {
    const doc = list.ownerDocument;
    const candidates = Array.from(doc.querySelectorAll<HTMLElement>('button, a, [role="button"], [data-show-more-virtual-list], [class*="load-more" i], [class*="show-more" i]'))
        .filter(el => {
            const text = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
            const hooked = Array.from(el.attributes).some(a => /^data-.*(show|load)-?more/i.test(a.name));
            if (!hooked && !MORE.test(text)) return false;
            if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
            // A link to another page isn't "more of this list" (a "Show more posts" that goes to a login page):
            // clicking it would end the run with the page.
            if (!hooked && el.matches('a[href]') && navigates(el as HTMLAnchorElement)) return false;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || el.closest('[hidden]')) return false;
            // Inside the list or after it: never a "See more" of a block above it.
            return list.contains(el) || !!(list.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
    // Nearest to the list's end, in document order.
    return candidates[0] ?? null;
}

/** A link that loads another page (not `#`, `javascript:`, or this page's own address). */
function navigates(a: HTMLAnchorElement): boolean {
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return false;
    try {
        const url = new URL(href, location.href);
        return url.origin + url.pathname + url.search !== location.origin + location.pathname + location.search;
    } catch { return false; }
}

/** What scrolls the list: its nearest scrolling ancestor, else the page. */
export function scrollerFor(el: Element): HTMLElement | Window {
    for (let p: Element | null = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (/(auto|scroll|overlay)/.test(style.overflowY) && p.scrollHeight > p.clientHeight + 20) return p as HTMLElement;
    }
    return window;
}
