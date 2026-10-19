/**
 * Repeated items on a page: the list around a hovered element, the item (card / row) it belongs
 * to, a list inside a clicked element, and which of a list's children are really items.
 *
 * Finding the list is cheap (tag counting, it runs on every hover). Deciding which children are
 * items uses the same row check as field inference (`fields/gate.ts`), so the picker and the
 * extraction agree on what a row is.
 */
import { getVisualRect, hasRenderedBox } from '../../utils/rendering';
import { collectAtoms, withAtomCache } from './atoms';
import { gateRows } from './fields/gate';

export interface ListMatch {
    isContainer: boolean;
    containerType?: 'list' | 'table';
    container: HTMLElement | null;
    childCount: number;
    /** The items. */
    siblings: HTMLElement[];
}

const NONE: ListMatch = { isContainer: false, container: null, childCount: 0, siblings: [] };
/** Form controls are UI, not repeating data cards. */
const INTERACTIVE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'OPTION', 'TEXTAREA', 'LABEL']);
/** Deep enough to reach the list from a leaf inside a card (SPAs nest a price 15+ wrappers inside its card). */
const MAX_LEVELS_UP = 40;
const MIN_ITEMS = 2;

function match(container: HTMLElement, items: HTMLElement[]): ListMatch {
    return { isContainer: true, containerType: listType(container, items), container, siblings: items, childCount: items.length };
}

/** 'table' for table / list tags, or rows that mostly have the same small number of cells. */
function listType(container: HTMLElement, items: HTMLElement[]): 'list' | 'table' {
    if (['TABLE', 'TBODY', 'THEAD', 'UL', 'OL'].includes(container.tagName)) return 'table';
    if (items.length < 3) return 'list';
    const cells = items.map(s => s.children.length);
    if (cells.filter(n => n >= 2 && n <= 10).length / items.length < 0.8) return 'list';
    const freq = new Map<number, number>();
    cells.forEach(n => freq.set(n, (freq.get(n) ?? 0) + 1));
    const [mode, count] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    return mode >= 2 && count / cells.length >= 0.7 ? 'table' : 'list';
}

// ------------------------------------------------------------------------------- hover: the section

/** Rendered children that can be items: not separators, not form controls. */
function renderedChildren(el: HTMLElement): HTMLElement[] {
    return (Array.from(el.children) as HTMLElement[]).filter(c => c.tagName !== 'HR' && !INTERACTIVE_TAGS.has(c.tagName) && hasRenderedBox(c));
}

/** Per-hover caches: a hover asks about the same elements many times; the page doesn't change in between. */
let shapes = new WeakMap<Element, Map<string, number>>();
let contents = new WeakMap<Element, string>();
let boxes = new WeakMap<Element, DOMRect | null>();

/** Tag counts of a subtree (capped): what two cards of one list share whatever their text. */
function shapeOf(el: Element): Map<string, number> {
    let counts = shapes.get(el);
    if (counts) return counts;
    counts = new Map<string, number>([[el.tagName, 1]]);
    const all = el.querySelectorAll('*');
    for (let i = 0; i < Math.min(all.length, 300); i++) counts.set(all[i].tagName, (counts.get(all[i].tagName) ?? 0) + 1);
    shapes.set(el, counts);
    return counts;
}

function similarity(a: Map<string, number>, b: Map<string, number>): number {
    let dot = 0, na = 0, nb = 0;
    for (const [k, v] of a) { dot += v * (b.get(k) ?? 0); na += v * v; }
    for (const v of b.values()) nb += v * v;
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** What an element holds: an image, a link, text. */
function contentOf(el: Element): string {
    let k = contents.get(el);
    if (k === undefined) {
        k = `${el.querySelector('img, picture, svg') ? 'i' : ''}${el.matches('a[href]') || el.querySelector('a[href]') ? 'a' : ''}${(el.textContent || '').trim() ? 't' : ''}`;
        contents.set(el, k);
    }
    return k;
}

const isEmpty = (el: Element) => contentOf(el) === '';

/** The element's box, or null on a page without layout (unit tests): size checks are skipped then. */
function boxOf(el: HTMLElement): DOMRect | null {
    if (boxes.has(el)) return boxes.get(el)!;
    const r = getVisualRect(el);
    const box = r.width > 0 || r.height > 0 ? r : null;
    boxes.set(el, box);
    return box;
}

const area = (r: DOMRect | null) => (r ? r.width * r.height : 0);

/** Width and height ratios within the given bounds, when there is layout to tell. */
function sized(a: HTMLElement, b: HTMLElement, w: [number, number], h: [number, number]): boolean {
    const ra = boxOf(a);
    const rb = boxOf(b);
    if (!ra || !rb || !rb.width || !rb.height) return true;
    const x = ra.width / rb.width;
    const y = ra.height / rb.height;
    return x >= w[0] && x <= w[1] && y >= h[0] && y <= h[1];
}

/**
 * `s` is a card like `ref`: the same tag, a similar size, a similar subtree holding the same kinds of
 * content (a card missing its image still matches when its structure is close). A card's title
 * block and price block hold different content: not alike. A placeholder (the card's element,
 * nothing in it yet) is a card still loading.
 */
function alike(s: HTMLElement, ref: HTMLElement): boolean {
    if (s === ref) return true;
    if (s.tagName !== ref.tagName) return false;
    if (isEmpty(s) || isEmpty(ref)) return isEmpty(s) && placeholderOf(s, ref);
    if (!sized(s, ref, [0.5, 2], [0.33, 3])) return false;
    return similarity(shapeOf(s), shapeOf(ref)) >= (contentOf(s) === contentOf(ref) ? 0.6 : 0.85);
}

/** A placeholder for a card like `ref`: the same tag and most of its classes (a "shell" class added). */
function placeholderOf(s: Element, ref: Element): boolean {
    if (s.tagName !== ref.tagName) return false;
    const own = Array.from(ref.classList);
    if (own.length === 0) return s.classList.length === 0;
    return own.filter(c => s.classList.contains(c)).length >= own.length * 0.5;
}

/**
 * A card: holds something to read, is big enough to be one (not a skeleton bit, a star, a dot), and
 * fits on about a screen and a half, or is narrow (a grid cell stretched to its row's height). A
 * page column holding a whole grid is a section.
 */
function cardLike(el: HTMLElement): boolean {
    if (isEmpty(el)) return false;
    const r = boxOf(el);
    if (!r) return true;
    if (r.width < 40 || r.height < 16) return false;
    const vw = window.innerWidth || 1280;
    return r.width * r.height <= vw * (window.innerHeight || 800) * 1.5 || r.width <= vw * 0.5;
}

/**
 * When `row` is a row of cells (a grid rendered one `ul` per row, posts in rows of three): the
 * element holding its cells, found through single or dominant (≥ 70%) children, at most three
 * levels down. Cells are same-tag, same-size children covering most of it.
 */
function cellsParent(row: HTMLElement): HTMLElement | null {
    const rowArea = area(boxOf(row));
    let e = row;
    for (let d = 0; d <= 3; d++) {
        const kids = renderedChildren(e);
        if (kids.length >= MIN_ITEMS) {
            // A row of placeholders (cards not rendered yet) is a row too: measured by its first cell.
            const lead = kids.find(cardLike) ?? kids[0];
            const cells = lead ? kids.filter(k => k.tagName === lead.tagName && sized(k, lead, [0.85, 1.18], [0.67, 1.5])) : [];
            const covered = cells.reduce((n, k) => n + area(boxOf(k)), 0);
            if (cells.length >= MIN_ITEMS && (rowArea ? covered >= area(boxOf(e)) * 0.7 : cells.length === kids.length)) return sideways(row, e) ? null : e;
            const main = rowArea ? kids.find(k => area(boxOf(k)) >= rowArea * 0.7) : undefined;
            if (!main) return null;
            e = main;
        } else if (kids.length === 1) {
            e = kids[0];
        } else {
            return null;
        }
    }
    return null;
}

/**
 * Cells that run past the row sideways (a carousel: four cards in a strip showing two): a section of
 * its own, never one row of a bigger grid.
 */
function sideways(row: HTMLElement, cells: HTMLElement): boolean {
    for (let e: HTMLElement | null = cells; e && e !== row.parentElement; e = e.parentElement) {
        if (e.scrollWidth > e.clientWidth + 20) return true;
    }
    return false;
}

/**
 * The cards of `container` like the child holding the hovered element: its alike children, or,
 * when that child is a row of cells, the cells like the hovered one across the container's alike
 * rows. Most of the container must be these cards (≥ 40% of its children hold one): an app shell
 * whose header, pane and map are `div`s is not a list.
 */
function cardsIn(container: HTMLElement, child: HTMLElement, element: HTMLElement): HTMLElement[] | null {
    const children = renderedChildren(container);
    if (children.length < MIN_ITEMS) return null;
    let items: HTMLElement[] = [];
    // Everything that could be a card here: the children, or the cells of the alike rows.
    let pool: HTMLElement[] = children;
    const cells = cellsParent(child);
    const cell = cells ? (Array.from(cells.children) as HTMLElement[]).find(c => c.contains(element)) : undefined;
    if (cells && cell && cardLike(cell)) {
        const rows = children.filter(r => r === child || (r.tagName === child.tagName && similarity(shapeOf(r), shapeOf(child)) >= 0.6));
        pool = rows.flatMap(r => {
            const parent = r === child ? cells : cellsParent(r);
            return parent ? renderedChildren(parent) : [];
        });
        items = pool.filter(c => alike(c, cell));
    } else if (cardLike(child)) {
        items = children.filter(c => alike(c, child));
    }
    items = consensus(items, pool);
    if (items.length < MIN_ITEMS) return null;
    const holders = children.filter(c => items.some(i => c === i || c.contains(i)));
    return holders.length >= children.length * 0.4 ? items : null;
}

/**
 * The section's cards, whichever card is hovered: the ones alike to at least half of the cards
 * found from the hovered one. A borderline widget alike to one card but not the others stays out,
 * and a card the hovered one happened not to match comes in.
 */
function consensus(found: HTMLElement[], pool: HTMLElement[]): HTMLElement[] {
    if (found.length < 3 || pool.length > 120) return found;
    const sample = found.filter(f => !isEmpty(f)).slice(0, 24);
    if (sample.length < 3) return found;
    return pool.filter(c => found.includes(c) && isEmpty(c) ? true : sample.filter(f => alike(c, f)).length >= sample.length / 2);
}

/** A scrolling pane (a results pane beside a map) or a dialog: the section doesn't reach past it. */
function isBoundary(el: HTMLElement): boolean {
    if (el.matches('dialog, [role="dialog"], [aria-modal="true"]')) return true;
    const style = getComputedStyle(el);
    if (!/(auto|scroll|overlay)/.test(style.overflowY) || el.scrollHeight <= el.clientHeight + 20) return false;
    return el.clientHeight >= Math.max(300, (window.innerHeight || 800) * 0.4);
}

/**
 * Whether the cards found further up replace the list found nearer the element.
 *
 * - The nearer list sits inside one of the cards: it is a part of that card when it repeats in the
 *   other cards (price lines, swatches, a card's blocks: in a third of the others or more), and the
 *   cards win. When it doesn't (a carousel inside one of a page's blocks), the "cards" are page
 *   sections and the list stays.
 * - Otherwise the cards win only when they are clearly more (≥ 1.5× and 2 more): the grid over one
 *   of its rows, never a page wrapper over the grid.
 */
function moveUp(best: { el: HTMLElement; items: HTMLElement[] }, cards: HTMLElement[]): boolean {
    const holder = cards.find(c => c !== best.el && c.contains(best.el));
    if (holder) {
        const part = best.items.find(i => !isEmpty(i)) ?? best.items[0];
        const others = cards.filter(c => c !== holder).slice(0, 9);
        const repeated = others.filter(c => (Array.from(c.querySelectorAll(part.tagName)) as HTMLElement[]).slice(0, 60).some(e => alike(e, part)));
        return repeated.length >= Math.max(1, others.length / 3);
    }
    return cards.length >= Math.max(best.items.length * 1.5, best.items.length + 2);
}

/** "div.sku-block 218x396", for the debug trace. */
function describe(el: HTMLElement): string {
    const r = boxOf(el);
    return `${el.tagName.toLowerCase()}${el.classList[0] ? '.' + el.classList[0] : ''}${r ? ` ${Math.round(r.width)}x${Math.round(r.height)}` : ''}`;
}

/** A hover must never stall the page: past this, the nearest section found so far is the answer. */
const BUDGET_MS = 20;
let lastFind: { element: HTMLElement; at: number; result: ListMatch } | null = null;

/**
 * The section around a hovered element (List Extractor hover): the nearest container whose
 * children are cards like the one under the cursor. Walking up from the element, the first such
 * container is kept; one further up replaces it with clearly more cards (≥ 1.5× and 2 more), or when
 * the nearer list is a small part of one of its cards (swatches, price lines): so the result is the
 * same wherever in a card the pointer is, and a page wrapper never wins over the grid. The
 * walk stops at a scrolling pane or dialog once a section is found. Only the element's ancestors and
 * their children are looked at: nothing else on the page.
 */
export function findList(element: HTMLElement): ListMatch {
    if (lastFind && lastFind.element === element && performance.now() - lastFind.at < 1000) return lastFind.result;
    shapes = new WeakMap();
    contents = new WeakMap();
    boxes = new WeakMap();
    const started = performance.now();
    // The sections considered, when the page has `data-cp-debug` on <html>.
    const debug: string[] | null = document.documentElement.hasAttribute('data-cp-debug') ? [] : null;
    let best: { el: HTMLElement; items: HTMLElement[] } | null = null;
    let child = element;
    let el = element.parentElement;
    for (let level = 0; el && el !== document.body && el !== document.documentElement && level < MAX_LEVELS_UP; level++) {
        const items = cardsIn(el, child, element);
        if (items && (!best || moveUp(best, items))) best = { el, items };
        if (debug) {
            const cells = cellsParent(child);
            debug.push(`${level} ${describe(el)} [child ${describe(child)}${cells ? `, rows of cells in ${describe(cells)}` : ''}]: ${items ? `${items.length} × ${describe(items[0])}` : '–'}${best?.el === el ? ' ← best' : ''}`);
        }
        if (best && (isBoundary(el) || performance.now() - started > BUDGET_MS)) break;
        child = el;
        el = el.parentElement;
    }
    const result = best ? match(best.el, best.items) : NONE;
    if (debug) {
        // Read by the hover scorecard (e2e/picker.spec.ts) and useful in a bug report.
        debug.push(`${Math.round(performance.now() - started)} ms`);
        document.documentElement.setAttribute('data-cp-debug', debug.join('\n'));
    }
    lastFind = { element, at: performance.now(), result };
    return result;
}

/** The item (card / row) of `container` that holds `target`. */
export function itemOf(target: HTMLElement, container: HTMLElement): HTMLElement {
    let el: HTMLElement = target;
    while (el.parentElement && el.parentElement !== container) {
        if (el.parentElement === document.body) return target;
        el = el.parentElement;
    }
    return el.parentElement === container ? el : target;
}

/**
 * The items among a list's children: the ones with the list's common structure (cards, rows),
 * without headers, spacers, ad blocks and widgets. Placeholders (an item's element with nothing in
 * it yet: lazy grids render cards on scroll) are kept, as items still loading. Falls back to all of
 * them when fewer than two pass.
 */
export function keepItems(children: HTMLElement[]): HTMLElement[] {
    if (children.length < 4) return children;
    return withAtomCache(() => {
        const atoms = children.map(collectAtoms);
        const { keep } = gateRows(children, atoms);
        const rendered = children.filter((_, i) => keep[i] && atoms[i].length > 0);
        const items = children.filter((c, i) => (keep[i] && atoms[i].length > 0) || (atoms[i].length === 0 && rendered.some(r => placeholderOf(c, r))));
        return rendered.length >= MIN_ITEMS ? items : children;
    });
}

/** A UL/OL whose items each wrap a single thing is an array of values (images, links), not a list of records. */
function isSimpleArray(items: HTMLElement[]): boolean {
    if (items.length === 0) return false;
    const avg = items.reduce((s, e) => s + e.children.length, 0) / items.length;
    if (avg <= 1) return true;
    return items.every(e => Array.from(e.children).every(c => INTERACTIVE_TAGS.has(c.tagName)));
}

function recordItems(list: HTMLElement): HTMLElement[] | null {
    const items = (Array.from(list.children) as HTMLElement[]).filter(c =>
        hasRenderedBox(c) && (c.textContent || '').trim().length > 0 && !INTERACTIVE_TAGS.has(c.tagName));
    if (items.length < MIN_ITEMS || isSimpleArray(items)) return null;
    if (['UL', 'OL'].includes(list.tagName) && items.reduce((s, li) => s + li.children.length, 0) / items.length <= 1.5) return null;
    return items;
}

/**
 * A list of records inside a clicked element (Page Extractor): the element itself, a list or table
 * in it, or (deep scan, first 300 descendants) the descendant with the most items. Simple arrays of
 * images / links / texts are left to the array classifiers.
 */
export function findListInside(element: HTMLElement): ListMatch {
    const own = recordItems(element);
    if (own) return match(element, own);
    if (['UL', 'OL'].includes(element.tagName)) return NONE;

    for (const list of Array.from(element.querySelectorAll<HTMLElement>('ul, ol, table, tbody, [role="list"]'))) {
        const items = recordItems(list);
        if (items) return match(list, items);
    }

    let best: { el: HTMLElement; items: HTMLElement[] } | null = null;
    const all = element.querySelectorAll<HTMLElement>('*');
    for (let i = 0; i < Math.min(all.length, 300); i++) {
        const items = recordItems(all[i]);
        if (items && items.length > (best?.items.length ?? 0)) best = { el: all[i], items };
    }
    return best ? match(best.el, best.items) : NONE;
}
