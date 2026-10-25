/**
 * What a picked section is (`docs/plans/picker-container-bound-plan.md`): ordinary results, a
 * sponsored shelf or a carousel, and the heading above it. Only the picked container is looked at:
 * the picker works one section at a time, and the user picks another section as another list.
 *
 * Nothing here knows a site: "sponsored" comes from a short word list.
 */
import type { ListKind } from '../../../shared/messages';

const SPONSORED = /(^|[\s_\-:])(sponsor(ed)?|advert(isement)?s?|ads?|promoted)([\s_\-:]|$)/i;
/** How far up an ancestor's name (not its text) can mark a section sponsored. */
const SPONSORED_LEVELS = 8;
const SPONSORED_TEXT = /^\s*(sponsored|ad|ads|advertisement|promoted)\b/i;

function sponsoredSignal(el: Element): boolean {
    const attrs = ['id', 'class', 'data-testid', 'data-test-id', 'aria-label', 'data-component-type', 'data-component'];
    return attrs.some(a => SPONSORED.test(el.getAttribute(a) || ''));
}

/** A short "Sponsored" label element, outside the items. */
function isSponsoredLabel(el: Element, items: HTMLElement[]): boolean {
    const text = (el.textContent || '').trim();
    return text.length < 40 && SPONSORED_TEXT.test(text) && !items.some(i => i.contains(el));
}

function kindOf(group: { container: HTMLElement; items: HTMLElement[] }): ListKind {
    const first = group.items[0];
    const before = (el: Element) => !!(el.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
    // The group is labelled sponsored by its own markup, or by a header before its first item: inside
    // the container, or a direct child of a near ancestor ahead of it. A label after the items start
    // belongs to a cell among them (an ad in a grid of results), not to the group.
    // An ancestor named for ads ("sponsored-sbb", "ad-slot") covers everything inside it.
    for (let el: Element | null = group.container, level = 0; el && el !== document.body && level <= SPONSORED_LEVELS; el = el.parentElement, level++) {
        if (sponsoredSignal(el)) return 'sponsored';
    }
    // Elements on the way from the container down to the items; a branch off them holding an image
    // or a link is a cell of the grid (an ad among the results), not a header of the group.
    const lineage = new Set<Element>([group.container]);
    for (const item of group.items) for (let p = item.parentElement; p && p !== group.container; p = p.parentElement) lineage.add(p);
    const inCell = (label: Element) => {
        for (let c: Element | null = label; c && c !== group.container; c = c.parentElement) {
            if (c.parentElement && lineage.has(c.parentElement) && !lineage.has(c) && c.querySelector('img, a')) return true;
        }
        return false;
    };
    for (const label of Array.from(group.container.querySelectorAll('span, p, div, h2, h3, h4, small')).slice(0, 200)) {
        if (!before(label)) break;
        if (isSponsoredLabel(label, group.items) && !inCell(label)) return 'sponsored';
    }
    let el: HTMLElement | null = group.container;
    for (let level = 1; level <= 2 && el?.parentElement && el.parentElement !== document.body; level++) {
        const branch: HTMLElement = el;
        el = el.parentElement;
        for (const child of Array.from(el.children)) {
            if (child === branch) break;
            if (isSponsoredLabel(child, group.items) || Array.from(child.querySelectorAll('span, p, small')).slice(0, 20).some(l => isSponsoredLabel(l, group.items))) return 'sponsored';
        }
    }
    // One row of items in a box that scrolls sideways.
    const tops = new Set(group.items.map(i => Math.round(i.getBoundingClientRect().top)));
    const box = group.container;
    if (group.items.length >= 2 && tops.size === 1 && box.scrollWidth > box.clientWidth * 1.2) return 'carousel';
    return 'results';
}

function headingOf(container: HTMLElement): string | undefined {
    let el: HTMLElement | null = container.parentElement;
    for (let level = 0; el && level <= 3 && el !== document.body; level++, el = el.parentElement) {
        // The last heading before the group, outside it.
        const before = Array.from(el.querySelectorAll('h1, h2, h3, h4'))
            .filter(h => !container.contains(h) && h.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_FOLLOWING);
        const text = (before[before.length - 1]?.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) return text.slice(0, 60);
    }
    return undefined;
}

/** "Results · 18 items", "Sponsored · 3 items", "Customers also viewed · 6 items". */
export function sectionLabel(container: HTMLElement, items: HTMLElement[], count = items.length): { label: string; kind: ListKind } {
    const kind = kindOf({ container, items });
    const name = kind === 'results' ? (headingOf(container) || 'Results') : kind === 'sponsored' ? 'Sponsored' : 'Carousel';
    return { kind, label: `${name} · ${count} item${count === 1 ? '' : 's'}` };
}
