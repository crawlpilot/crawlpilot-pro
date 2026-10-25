/**
 * Finds the list's Next (or "Load more") control without asking the user to point at it, so a list
 * can run over several pages in one click (docs/plans/ux-simplification-plan.md §4.3). It stores the
 * same chain as a control picked by hand (`nextButtonSelectors`). Nothing found: the run stays on
 * this page and the user can still pick the control in the Pages step.
 *
 * With the picked list known, the control is the list's own: candidates inside its items (a card's
 * image arrows), in a region beside it (a filter sidebar's "Show more brands", the header) or before
 * it are passed over, and the closest one after the list wins.
 */
import { isHidden } from '../extraction/atoms';
import { nextButtonSelectors } from '../selectors/nextButton';

export interface NextControl {
    mode: 'pagination' | 'loadMore';
    /** The control's chain, best first (the run clicks or follows the first that matches). */
    selectors: string[];
    /** What it says ("Next", "Load more"), for the sentence the panel shows. */
    label: string;
}

/** The picked list: its container and items (the control belongs to it, not to the page around it). */
export interface ListContext {
    container: Element;
    items: Element[];
}

const NEXT_TEXT = /^(next( page)?|›|»|→|>|next ›|next »|next →)$/i;
const NEXT_LABEL = /\bnext( page)?\b/i;
/** An icon-only arrow in a pager says "next" in its class (`pagination__next`, `next-btn`). */
const NEXT_CLASS = /(^|[\s_-])next([\s_-]|$)/i;
const MORE_TEXT = /^((load|show|view|see) (\d+ )?more( results| products| items| posts| articles)?|more (results|products|items|posts|articles))\b/i;
/** "Show more" that opens a section's details, not more of the list. */
const MORE_NOT_LIST = /\bmore (filters?|options|details|info|brands?|colou?rs|sizes|reviews|comments|categories|less)\b/i;
const PAGER = 'nav, [role="navigation"], [class*="paginat" i], [class*="pager" i], [aria-label*="paginat" i], [data-testid*="paginat" i]';

/** Carousels and sliders have Next arrows that move pictures, not pages. */
const CAROUSEL = '[class*="carousel" i], [class*="slider" i], [class*="scroller" i], [class*="swiper" i], [data-testid*="carousel" i], [data-testid*="scroller" i], [aria-roledescription*="carousel" i]';
const CAROUSEL_LABEL = /\b(slide|slides|carousel|scroll|image|photo)\b/i;
/** Regions whose controls are about something else (the site's chrome, a dialog, a sidebar). */
const ELSEWHERE = 'aside, dialog, [role="dialog"], [role="complementary"], [role="banner"], [role="contentinfo"]';
/** With the list known, also filters and forms beside it (a page-wide wrapper with these names holds the list). */
const ELSEWHERE_NEAR_LIST = `${ELSEWHERE}, form, [class*="filter" i], [class*="facet" i], [class*="refine" i], [class*="sidebar" i]`;

const textOf = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const inCarousel = (el: Element) => !!el.closest(CAROUSEL) || CAROUSEL_LABEL.test(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`);

function usable(el: Element): boolean {
    if (el.closest('[hidden], [aria-hidden="true"]') || isHidden(el)) return false;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
    return !/(^|[\s_-])disabled([\s_-]|$)/i.test(el.getAttribute('class') || '');
}

function controls(doc: Document): Element[] {
    return Array.from(doc.querySelectorAll('a[href], button, [role="button"], input[type="button"], input[type="submit"]')).slice(0, 4000);
}

/** Inside a region that is not the list's (one that holds the list, like a page-wide wrapper, is fine). */
function elsewhere(el: Element, list?: ListContext): boolean {
    const region = el.closest(list ? ELSEWHERE_NEAR_LIST : ELSEWHERE);
    return !!region && !(list && region.contains(list.container));
}

/** Levels from the list's container up to the element's nearest shared ancestor (0: inside the container). */
function distance(list: Element, el: Element): number {
    let n = 0;
    for (let a: Element | null = list; a; a = a.parentElement, n++) if (a.contains(el)) return n;
    return Infinity;
}

const before = (list: Element, el: Element) => !!(list.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) && !list.contains(el);

/** The list's candidates, best first: after the list before before it, then the closest to it. */
function rank(candidates: Element[], list?: ListContext, keep: (el: Element) => boolean = () => true): Element[] {
    if (!list) return candidates.filter(keep);
    const own = candidates.filter(el => keep(el) && !list.items.some(item => item.contains(el)));
    const score = (el: Element) => distance(list.container, el) + (before(list.container, el) ? 100 : 0);
    return own.map(el => ({ el, s: score(el) })).sort((a, b) => a.s - b.s).map(c => c.el);
}

/** The best Next control: `rel="next"`, then a "Next" text, label or pager arrow, a pager's first. */
function findNext(doc: Document, list?: ListContext): Element | null {
    const rel = rank(Array.from(doc.querySelectorAll('a[rel~="next"]')).filter(el => usable(el) && !inCarousel(el)), list)[0];
    if (rel) return rel;
    const isNext = (el: Element) => NEXT_TEXT.test(textOf(el)) || NEXT_LABEL.test(el.getAttribute('aria-label') || '') || NEXT_LABEL.test(el.getAttribute('title') || '')
        || (!textOf(el) && NEXT_CLASS.test(el.getAttribute('class') || '') && !!el.closest(PAGER));
    const all = controls(doc).filter(el => isNext(el) && !inCarousel(el) && usable(el));
    // Carousels have "next" arrows too: a pager's control wins, then one that is a link to another page.
    const inPager = rank(all.filter(el => el.closest(PAGER)), list, el => !el.closest('[role="dialog"], dialog'));
    if (inPager[0]) return inPager[0];
    const links = rank(all.filter(el => el.tagName === 'A' && !(el.getAttribute('href') || '').startsWith('#')), list, el => !elsewhere(el, list));
    return links.find(el => !list || !before(list.container, el)) ?? null;
}

/** The list's "Load more": below it, not a disclosure ("Show more" details) or a sidebar's. */
function findMore(doc: Document, list?: ListContext): Element | null {
    const all = controls(doc).filter(el => {
        const text = textOf(el);
        return MORE_TEXT.test(text) && !MORE_NOT_LIST.test(text) && !el.hasAttribute('aria-expanded') && usable(el);
    });
    return rank(all, list, el => !elsewhere(el, list) && !(list && before(list.container, el)))[0] ?? null;
}

export function findNextControl(doc: Document = document, list?: ListContext | null): NextControl | null {
    const at = list ?? undefined;
    const next = findNext(doc, at);
    if (next) {
        const selectors = nextButtonSelectors(next as HTMLElement).map(c => c.selector);
        if (selectors.length) return { mode: 'pagination', selectors, label: textOf(next) || next.getAttribute('aria-label') || 'Next' };
    }
    const more = findMore(doc, at);
    if (more) {
        const selectors = nextButtonSelectors(more as HTMLElement).map(c => c.selector);
        if (selectors.length) return { mode: 'loadMore', selectors, label: textOf(more) };
    }
    return null;
}
