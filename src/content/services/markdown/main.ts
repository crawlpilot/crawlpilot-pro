/**
 * Main content, on the composed copy (thenos `clean/sanitize.py`, `clean/selectors.py`,
 * `main/floating.py`, `main/pruning.py`):
 *
 * - **Named boilerplate** (`header`, `nav`, `.sidebar`, `#cookie`…) is removed, unless it holds
 *   force-included content or the page's first `h1` (an `<article><header><h1>` keeps its title).
 * - **Floating chrome** (`data-cp-pos`: fixed or sticky) is removed in `fit`, unless it holds the `h1`,
 *   `main` or `article` (a sticky product summary can be the content).
 * - **Density pruning** (`fit`): every element scored on text density, link density, tag, class/id
 *   hints and text length (crawl4ai's `PruningContentFilter` with thenos's fixes); subtrees under the
 *   threshold are dropped. Tables, code, figures, definition lists and quotes are never entered, and
 *   content images keep their text-less wrappers.
 * - **Repeated items are data** (an addition to the thenos pruner): an element with 2+ siblings of the
 *   same tag and class (a product card, a result row) and under 600 characters is kept whole unless it
 *   is almost all link text (a menu). A card's text is short and half link, which density scoring reads as chrome.
 */
import { POSITION_ATTRIBUTE } from './compose';

export const BOILERPLATE_SELECTORS = [
    'header', 'footer', 'nav', 'aside', '.header', '.top', '.navbar', '#header', '.footer', '.bottom', '#footer',
    '.sidebar', '.side', '.aside', '#sidebar', '.modal', '.popup', '#modal', '.overlay', '.ad', '.ads', '.advert',
    '#ad', '.lang-selector', '.language', '#language-selector', '.social', '.social-media', '.social-links',
    '#social', '.menu', '.navigation', '#nav', '.breadcrumbs', '#breadcrumbs', '.share', '#share', '.widget',
    '#widget', '.cookie', '#cookie', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
];
/** Narrow on purpose: `article` or `main` here would keep every `<aside>` of related cards. */
const FORCE_INCLUDE_SELECTORS = ['#main'];

function holdsForced(el: Element): boolean {
    return FORCE_INCLUDE_SELECTORS.some(s => el.matches(s) || el.querySelector(s));
}

export function removeBoilerplate(root: Element): number {
    const h1 = root.querySelector('h1');
    const matches = new Set<Element>();
    for (const selector of BOILERPLATE_SELECTORS) {
        root.querySelectorAll(selector).forEach(el => { if (el !== root) matches.add(el); });
    }
    let dropped = 0;
    for (const el of matches) {
        if (!root.contains(el) || holdsForced(el) || (h1 && el.contains(h1))) continue;
        el.remove();
        dropped++;
    }
    return dropped;
}

export function dropFloating(root: Element): number {
    let dropped = 0;
    for (const el of Array.from(root.querySelectorAll(`[${POSITION_ATTRIBUTE}]`))) {
        if (!root.contains(el) || el.parentElement?.closest(`[${POSITION_ATTRIBUTE}]`)) continue;
        if (/^(html|body|main|article)$/.test(el.localName) || el.querySelector('h1, main, article')) continue;
        el.remove();
        dropped++;
    }
    return dropped;
}

// ─── Density pruning ──────────────────────────────────────────────────────────

export const PRUNE_THRESHOLD = 0.48;
const WEIGHTS = { textDensity: 0.4, linkDensity: 0.2, tagWeight: 0.2, classId: 0.1, textLength: 0.1 };
const TAG_WEIGHTS: Record<string, number> = { article: 1.5, p: 1.0, section: 1.0, div: 0.5, span: 0.3, li: 0.5, ul: 0.5, ol: 0.5, h1: 1.2, h2: 1.1, h3: 1.0, h4: 0.9, h5: 0.8, h6: 0.7 };
const TAG_IMPORTANCE: Record<string, number> = { article: 1.5, main: 1.4, section: 1.3, p: 1.2, h1: 1.4, h2: 1.3, h3: 1.2, div: 0.7, span: 0.6 };
const NEGATIVE = /nav|footer|header|sidebar|\bads?\b|comment|promo|advert|social|share|cookie|banner/i;
const PRESERVE = new Set(['table', 'pre', 'figure', 'dl', 'blockquote']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const IMAGE_LINK_RATIO = 0.5;
const ITEM_MIN_SIBLINGS = 3;
const ITEM_LINK_RATIO = 0.8;
/** Items are small: a page section that repeats its wrapper class (`div.a-section`) is not one. */
const ITEM_MAX_TEXT = 600;
const ICON_PX = 24;

interface Metrics { text: number; inner: number; link: number }

function computeMetrics(start: Element): Map<Element, Metrics> {
    const order: Element[] = [];
    const stack: Element[] = [start];
    while (stack.length) {
        const el = stack.pop()!;
        order.push(el);
        if (!PRESERVE.has(el.localName)) stack.push(...Array.from(el.children));
    }
    const metrics = new Map<Element, Metrics>();
    for (let i = order.length - 1; i >= 0; i--) {
        const el = order[i];
        let text = 0, inner = 0, link = 0;
        for (const node of Array.from(el.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                const raw = node.nodeValue ?? '';
                text += raw.trim().length;
                inner += raw.length;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const child = node as Element;
                const m = metrics.get(child);
                if (m) {
                    text += m.text;
                    inner += outerLength(child, m.inner);
                    if (child.localName === 'a') link += m.text;
                    else link += m.link;
                } else {
                    const preserved = (child.textContent ?? '').trim().length;
                    text += preserved;
                    inner += preserved;
                }
            }
        }
        metrics.set(el, { text, inner, link });
    }
    return metrics;
}

function outerLength(el: Element, inner: number): number {
    const tag = el.localName;
    const attrs = Array.from(el.attributes).reduce((n, a) => n + 4 + a.name.length + a.value.length, 0);
    return VOID.has(tag) ? 1 + tag.length + attrs + 2 : 2 + tag.length + attrs + inner + 3 + tag.length;
}

function classIdScore(el: Element): number {
    let score = 0;
    if (NEGATIVE.test(el.getAttribute('class') ?? '')) score -= 0.5;
    if (NEGATIVE.test(el.id ?? '')) score -= 0.5;
    return score;
}

export function isIcon(img: Element): boolean {
    const sizes = ['width', 'height'].map(a => parseInt(img.getAttribute(a) ?? '', 10)).filter(Number.isFinite);
    if (sizes.length && Math.max(...sizes) <= ICON_PX) return true;
    const src = img.getAttribute('src') ?? '';
    if (/pixel|spacer|beacon|1x1|blank\.gif/i.test(src) && (!sizes.length || Math.max(...sizes) <= 100)) return true;
    return Boolean(img.closest('button'));
}

function holdsContentImage(el: Element, m: Metrics): boolean {
    if (classIdScore(el) < 0) return false;
    if (m.text && m.link / m.text > IMAGE_LINK_RATIO) return false;
    const images = el.localName === 'img' ? [el] : Array.from(el.querySelectorAll('img'));
    return images.some(img => {
        const src = (img.getAttribute('src') ?? '').trim();
        return Boolean(src) && !src.startsWith('data:') && !isIcon(img);
    });
}

/** One of 3+ siblings with the same tag and class, holding a little text that isn't almost all links. */
function isRepeatedItem(el: Element, m: Metrics): boolean {
    if (!m.text || m.text > ITEM_MAX_TEXT || m.link / m.text > ITEM_LINK_RATIO || !el.parentElement) return false;
    const key = `${el.localName}.${el.getAttribute('class') ?? ''}`;
    let same = 0;
    for (const sibling of Array.from(el.parentElement.children)) {
        if (`${sibling.localName}.${sibling.getAttribute('class') ?? ''}` === key && ++same >= ITEM_MIN_SIBLINGS) return true;
    }
    return false;
}

function score(el: Element, m: Metrics): number {
    const textDensity = m.inner > 0 ? m.text / m.inner : 0;
    const linkDensity = 1 - (m.text > 0 ? m.link / m.text : 0);
    const total = WEIGHTS.textDensity + WEIGHTS.linkDensity + WEIGHTS.tagWeight + WEIGHTS.classId + WEIGHTS.textLength;
    return (
        WEIGHTS.textDensity * textDensity
        + WEIGHTS.linkDensity * linkDensity
        + WEIGHTS.tagWeight * (TAG_WEIGHTS[el.localName] ?? 0.5)
        + WEIGHTS.classId * classIdScore(el)
        + WEIGHTS.textLength * Math.log(m.text + 1)
    ) / total;
}

function shouldRemove(el: Element, m: Metrics): boolean {
    const importance = TAG_IMPORTANCE[el.localName] ?? 0.7;
    const textRatio = m.inner > 0 ? m.text / m.inner : 0;
    const linkRatio = m.text > 0 ? m.link / m.text : 1;
    let threshold = PRUNE_THRESHOLD;
    if (importance > 1) threshold *= 0.8;
    if (textRatio > 0.4) threshold *= 0.9;
    if (linkRatio > 0.6) threshold *= 1.2;
    return score(el, m) < threshold;
}

/** Drops low-scoring subtrees under `root` (never `root` itself); how many were dropped. */
export function prune(root: Element): number {
    const metrics = computeMetrics(root);
    let dropped = 0;
    const visit = (el: Element) => {
        if (PRESERVE.has(el.localName) || holdsForced(el)) return;
        const m = metrics.get(el);
        if (!m || isRepeatedItem(el, m)) return;
        if (holdsContentImage(el, m)) {
            if (el.localName !== 'img') Array.from(el.children).forEach(visit);
            return;
        }
        if (shouldRemove(el, m)) {
            // Keep the text that follows it (like lxml's drop_tree keeps the tail).
            el.remove();
            dropped++;
            return;
        }
        Array.from(el.children).forEach(visit);
    };
    Array.from(root.children).forEach(visit);
    return dropped;
}
