/**
 * Reading content that is in the page but not shown (`docs/plans/page-extractor-background-plan.md`
 * P2): a collapsed accordion, a closed `<details>`, an inactive tab panel left in the DOM. Hidden
 * content has no `innerText` and its rows have no box, so it reads as empty. For the length of one
 * read, the element and its hidden ancestors are shown, then put back exactly as they were.
 */

interface Saved { el: HTMLElement; style: string | null; hidden: boolean; ariaHidden: string | null; open?: boolean }

/** Collapsed to nothing: `height: 0` (or `max-height: 0`) with its overflow cut, as accordions animate. */
function collapsed(cs: CSSStyleDeclaration): boolean {
    const zero = (v: string) => v === '0px' || v === '0';
    return (zero(cs.height) || zero(cs.maxHeight)) && cs.overflow !== 'visible';
}

function hiddenStyle(el: HTMLElement): boolean {
    if (el.hidden) return true;
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' || cs.contentVisibility === 'hidden' || collapsed(cs);
}

/** Runs `read` with `el` and every hidden ancestor shown; restores them after, whatever `read` does. */
export function whileShown<T>(el: Element, read: () => T): T {
    const saved: Saved[] = [];
    for (let e: Element | null = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
        const h = e as HTMLElement;
        if (e.tagName === 'DETAILS' && !e.hasAttribute('open') && e !== el) {
            saved.push({ el: h, style: h.getAttribute('style'), hidden: h.hidden, ariaHidden: h.getAttribute('aria-hidden'), open: false });
            e.setAttribute('open', '');
            continue;
        }
        if (!(h instanceof HTMLElement) || !hiddenStyle(h)) continue;
        saved.push({ el: h, style: h.getAttribute('style'), hidden: h.hidden, ariaHidden: h.getAttribute('aria-hidden') });
        h.hidden = false;
        const cs = getComputedStyle(h);
        if (cs.display === 'none') h.style.setProperty('display', 'block', 'important');
        if (cs.visibility === 'hidden') h.style.setProperty('visibility', 'visible', 'important');
        if (cs.contentVisibility === 'hidden') h.style.setProperty('content-visibility', 'visible', 'important');
        if (collapsed(cs)) {
            h.style.setProperty('height', 'auto', 'important');
            h.style.setProperty('max-height', 'none', 'important');
            h.style.setProperty('overflow', 'visible', 'important');
        }
    }
    try {
        return read();
    } finally {
        for (const s of saved.reverse()) {
            if (s.open === false) { s.el.removeAttribute('open'); continue; }
            if (s.style === null) s.el.removeAttribute('style'); else s.el.setAttribute('style', s.style);
            s.el.hidden = s.hidden;
            if (s.ariaHidden === null) s.el.removeAttribute('aria-hidden'); else s.el.setAttribute('aria-hidden', s.ariaHidden);
        }
    }
}
