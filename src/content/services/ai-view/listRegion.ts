/**
 * The list region of a listing page (docs/plans/ai-extract-v2-plan.md §3.2, rule 4): the container of
 * repeated items (product cards, result rows) that holds most of the page's text. AI Extract reads a
 * list from it alone, so navigation, filters and the footer are gone before the first call.
 *
 * A container qualifies when at least 5 of its children share a tag and first class (and are at least
 * half its children), carry 30+ characters each on average and aren't almost all link text (a menu).
 * The best one is the one with the most text in its items; it must hold at least 35% of the page's text,
 * so a product page's "related products" strip is never taken for the page. None found: `null`, and the
 * whole page is read as before.
 */
const CHROME = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="menu"], [role="menubar"], [role="listbox"], '
    + '[role="dialog"], [aria-modal="true"], #onetrust-consent-sdk, [id*="cookie" i], [class*="cookie" i], [id*="consent" i]';
const MIN_ITEMS = 5;
const MIN_ITEM_CHARS = 30;
const MENU_LINK_RATIO = 0.85;
const MIN_SHARE = 0.35;
/** Elements looked at, at most: a hover-free, one-off scan, but pages can be huge. */
const MAX_ELEMENTS = 30_000;

const NOT_TEXT = new Set(['script', 'style', 'noscript', 'template', 'svg']);

/** Text characters under `el`, without scripts and styles (a store page's inline JSON is not its text). */
function chars(el: Element): number {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!NOT_TEXT.has(node.parentElement?.localName ?? '')) n += (node.nodeValue ?? '').replace(/\s+/g, '').length;
    }
    return n;
}
const linkChars = (el: Element) => Array.from(el.querySelectorAll('a')).reduce((n, a) => n + chars(a), 0);
const signature = (el: Element) => `${el.localName}.${el.classList[0] ?? ''}`;
/** Document structure and running text, not cards: an article's sections or paragraphs aren't a list. */
const NOT_ITEMS = new Set(['section', 'p', 'span', 'a', 'br', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'figure', 'script', 'style']);
/** Cards are alike in size: the median item has at least this share of the mean item's text. */
const MIN_MEDIAN_SHARE = 0.3;

export interface ListRegion {
    el: Element;
    items: number;
}

export function listRegion(root: Element = document.body): ListRegion | null {
    const total = chars(root);
    if (!total) return null;
    let best: { el: Element; items: number; text: number } | null = null;
    const all = root.querySelectorAll('*');
    for (let i = 0; i < Math.min(all.length, MAX_ELEMENTS); i++) {
        const el = all[i];
        if (el.children.length < MIN_ITEMS || el.closest(CHROME)) continue;
        const groups = new Map<string, Element[]>();
        for (const child of Array.from(el.children)) {
            const key = signature(child);
            groups.set(key, [...(groups.get(key) ?? []), child]);
        }
        const group = [...groups.values()].sort((a, b) => b.length - a.length)[0];
        if (group.length < MIN_ITEMS || group.length < el.children.length / 2 || NOT_ITEMS.has(group[0].localName)) continue;
        const sizes = group.map(chars).sort((a, b) => a - b);
        const text = sizes.reduce((n, c) => n + c, 0);
        if (text / group.length < MIN_ITEM_CHARS || text <= (best?.text ?? 0)) continue;
        if (sizes[Math.floor(sizes.length / 2)] < (text / group.length) * MIN_MEDIAN_SHARE) continue;
        if (group.reduce((n, c) => n + linkChars(c), 0) / text > MENU_LINK_RATIO) continue;
        best = { el, items: group.length, text };
    }
    return best && best.text >= total * MIN_SHARE ? { el: best.el, items: best.items } : null;
}
