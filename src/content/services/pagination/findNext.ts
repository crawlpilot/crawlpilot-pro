/**
 * Finds the list's Next (or "Load more") control without asking the user to point at it, so a list
 * can run over several pages in one click (docs/plans/ux-simplification-plan.md §4.3). It stores the
 * same chain as a control picked by hand (`nextButtonSelectors`). Nothing found: the run stays on
 * this page and the user can still pick the control in the Pages step.
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

const NEXT_TEXT = /^(next( page)?|›|»|→|>|next ›|next »|next →)$/i;
const NEXT_LABEL = /\bnext( page)?\b/i;
const MORE_TEXT = /^(load|show|view|see) more\b/i;
const PAGER = 'nav, [role="navigation"], [class*="paginat" i], [class*="pager" i], [aria-label*="paginat" i], [data-testid*="paginat" i]';

/** Carousels and sliders have Next arrows that move pictures, not pages. */
const CAROUSEL = '[class*="carousel" i], [class*="slider" i], [class*="scroller" i], [class*="swiper" i], [data-testid*="carousel" i], [data-testid*="scroller" i], [aria-roledescription*="carousel" i]';
const CAROUSEL_LABEL = /\b(slide|slides|carousel|scroll|image|photo)\b/i;

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

/** The best Next control: `rel="next"`, then a "Next" text or label, inside a pager first. */
function findNext(doc: Document): Element | null {
    const rel = Array.from(doc.querySelectorAll('a[rel~="next"]')).find(usable);
    if (rel) return rel;
    const isNext = (el: Element) => NEXT_TEXT.test(textOf(el)) || NEXT_LABEL.test(el.getAttribute('aria-label') || '') || NEXT_LABEL.test(el.getAttribute('title') || '');
    const all = controls(doc).filter(el => isNext(el) && !inCarousel(el) && usable(el));
    // Carousels have "next" arrows too: a pager's control wins, then one that is a link to another page.
    return all.find(el => el.closest(PAGER)) ?? all.find(el => el.tagName === 'A' && !(el.getAttribute('href') || '').startsWith('#')) ?? null;
}

export function findNextControl(doc: Document = document): NextControl | null {
    const next = findNext(doc);
    if (next) {
        const selectors = nextButtonSelectors(next as HTMLElement).map(c => c.selector);
        if (selectors.length) return { mode: 'pagination', selectors, label: textOf(next) || next.getAttribute('aria-label') || 'Next' };
    }
    const more = controls(doc).find(el => MORE_TEXT.test(textOf(el)) && usable(el));
    if (more) {
        const selectors = nextButtonSelectors(more as HTMLElement).map(c => c.selector);
        if (selectors.length) return { mode: 'loadMore', selectors, label: textOf(more) };
    }
    return null;
}
