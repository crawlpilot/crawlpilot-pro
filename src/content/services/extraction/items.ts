/**
 * Repeated items on a page: the list around a hovered element, the item (card / row) it belongs
 * to, a list inside a clicked element, and which of a list's children are really items.
 *
 * Finding the list is cheap (tag counting, it runs on every hover). Deciding which children are
 * items uses the same row check as field inference (`fields/gate.ts`), so the picker and the
 * extraction agree on what a row is.
 */
import { hasRenderedBox } from '../../utils/rendering';
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
/** Deep enough to reach the list from a leaf inside a card (SPAs nest cards 12–14 wrappers deep). */
const MAX_LEVELS_UP = 16;
const MIN_ITEMS = 2;

function match(container: HTMLElement, items: HTMLElement[]): ListMatch {
    return { isContainer: true, containerType: listType(container, items), container, siblings: items, childCount: items.length };
}

/** Rendered children sharing the dominant tag (≥60% of them), or null when `el` isn't a list. */
function homogeneousChildren(el: HTMLElement): HTMLElement[] | null {
    // HRs are separators between cards, not items.
    const visible = (Array.from(el.children) as HTMLElement[]).filter(c => c.tagName !== 'HR' && !INTERACTIVE_TAGS.has(c.tagName) && hasRenderedBox(c));
    if (visible.length < MIN_ITEMS) return null;
    const counts = new Map<string, number>();
    visible.forEach(c => counts.set(c.tagName, (counts.get(c.tagName) ?? 0) + 1));
    const [tag, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (count < MIN_ITEMS || count / visible.length < 0.6) return null;
    return visible.filter(c => c.tagName === tag);
}

function listScore(el: HTMLElement, items: HTMLElement[]): number {
    let score = items.length * 2;
    if (['UL', 'OL', 'DL', 'TABLE', 'TBODY'].includes(el.tagName)) score += 20;
    if (el.getAttribute('role') === 'list') score += 15;
    if (/list|grid|card|product|result|item|feed|catalog|collection/.test((typeof el.className === 'string' ? el.className : '').toLowerCase())) score += 15;
    return score;
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

/** The best-scoring list among the element's ancestors (hover in the List Extractor). */
export function findList(element: HTMLElement): ListMatch {
    let best: { el: HTMLElement; items: HTMLElement[]; score: number } | null = null;
    let el: HTMLElement | null = element;
    for (let level = 0; el && el !== document.body && el !== document.documentElement && level < MAX_LEVELS_UP; level++, el = el.parentElement) {
        const items = homogeneousChildren(el);
        if (!items) continue;
        const score = listScore(el, items);
        if (!best || score > best.score) best = { el, items, score };
    }
    return best ? match(best.el, best.items) : NONE;
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

/** An element's tag and classes: what a not-yet-rendered placeholder shares with the items it will become. */
const shellOf = (el: Element) => `${el.tagName}|${Array.from(el.classList).sort().join(' ')}`;

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
        const shells = new Set(rendered.map(shellOf));
        const items = children.filter((c, i) => (keep[i] && atoms[i].length > 0) || (atoms[i].length === 0 && shells.has(shellOf(c))));
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
