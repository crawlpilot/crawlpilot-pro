/**
 * Item sets (`docs/plans/generic-list-selectors-plan.md` §2): a list is every element on the page
 * with the item's fingerprint, wherever it sits, not one container's children.
 *
 * `findList` finds the clicked item's siblings. From them:
 *
 * 1. **Fingerprint**: what names the items themselves (shared author hooks and naming classes, else
 *    an identity attribute's presence). When the items are bare wrappers, the element inside each
 *    that carries such a name (a product tile in a layout cell) is the item instead.
 * 2. **Matches**: every outermost element on the page with that fingerprint.
 * 3. **Groups**: matches grouped by region. Items whose parents look alike and sit within a few
 *    levels of each other are one group (a grid rendered as one `ul` per row, one tile per layout
 *    cell); a shelf wrapped differently is another.
 * 4. **Choice**: the clicked item's group, unless it is sponsored or a carousel and a like group of
 *    ordinary results exists (clicking a sponsored shelf above the results means the results). The
 *    other groups are offered as alternatives.
 *
 * Nothing here knows a site: names come from `shared/selectors/stability.ts`, "sponsored" from a
 * short word list.
 */
import { AUTHOR_ATTRIBUTES, IDENTITY_ATTRIBUTE, isNamingClass, isStableAttributeValue } from '../../../shared/selectors/stability';
import type { ListMatch } from './items';

export type GroupKind = 'results' | 'sponsored' | 'carousel';

export interface ItemGroup {
    container: HTMLElement;
    items: HTMLElement[];
    kind: GroupKind;
    /** A heading near the group, when there is one. */
    heading?: string;
}

export interface ItemSet extends ListMatch {
    /** Every group of the fingerprint on the page, the chosen one at `chosen`. */
    groups: ItemGroup[];
    chosen: number;
    /** The group the clicked element is in (differs from `chosen` when a sponsored click was redirected). */
    clicked: number;
}

/** Parents within this many levels of a common ancestor are one region. */
const MERGE_LEVELS = 3;
/** How deep inside a wrapper to look for the named item. */
const CORE_DEPTH = 4;
const CORE_NODES = 200;
const SAMPLE = 12;
/** Share of the items a name must be on to name them. */
const MAJORITY = 0.5;
const MAX_MATCHES = 3000;
const SPONSORED = /(^|[\s_\-:])(sponsor(ed)?|advert(isement)?s?|ads?|promoted)([\s_\-:]|$)/i;
/** How far up an ancestor's name (not its text) can mark a group sponsored. */
const SPONSORED_LEVELS = 8;
const SPONSORED_TEXT = /^\s*(sponsored|ad|ads|advertisement|promoted)\b/i;

function cssAttr(attr: string, value?: string): string {
    return value === undefined ? `[${attr}]` : `[${attr}="${value.replace(/["\\]/g, '\\$&')}"]`;
}

/**
 * A selector naming the items on their own element, from `reference` (the clicked item): its tag
 * with the author hooks and naming classes that most of the items share; an identity attribute's
 * presence when nothing else names them. Most, not all: a grid row with a sponsored cell of another
 * kind among its products is still a row of products. `null` when nothing names them (bare wrappers).
 */
export function itemFingerprint(items: Element[], reference: Element = items[0]): string | null {
    if (!reference) return null;
    const sample = [reference, ...items.filter(i => i !== reference).slice(0, SAMPLE - 1)];
    const most = (test: (el: Element) => boolean) => sample.filter(test).length >= Math.max(1, Math.ceil(sample.length * MAJORITY));
    const parts: string[] = [];
    for (const attr of AUTHOR_ATTRIBUTES) {
        const v = reference.getAttribute(attr);
        if (v !== null && isStableAttributeValue(attr, v) && most(i => i.tagName === reference.tagName && i.getAttribute(attr) === v)) parts.push(cssAttr(attr, v));
    }
    for (const c of Array.from(reference.classList)) {
        if (isNamingClass(c) && most(i => i.tagName === reference.tagName && i.classList.contains(c))) parts.push(`.${CSS.escape(c)}`);
    }
    if (parts.length === 0) {
        const id = reference.getAttributeNames().find(a => IDENTITY_ATTRIBUTE.test(a) && most(i => i.hasAttribute(a)));
        if (id) parts.push(cssAttr(id));
    }
    return parts.length ? reference.tagName.toLowerCase() + parts.join('') : null;
}

/** The named element inside each wrapper: the outermost descendant of `reference` whose fingerprint is in most items exactly once. */
function coreFingerprint(items: Element[], reference: Element): string | null {
    const sample = [reference, ...items.filter(i => i !== reference).slice(0, SAMPLE - 1)];
    const walk: Element[] = [];
    const visit = (el: Element, depth: number) => {
        for (const child of Array.from(el.children)) {
            if (walk.length >= CORE_NODES) return;
            walk.push(child);
            if (depth < CORE_DEPTH) visit(child, depth + 1);
        }
    };
    visit(reference, 1);
    for (const candidate of walk) {
        const fp = itemFingerprint([candidate]);
        if (!fp || !/\[/.test(fp)) continue; // a hook or identity attribute, not just a class
        try {
            if (reference.querySelectorAll(fp).length === 1 && sample.filter(i => i.querySelectorAll(fp).length === 1).length >= Math.ceil(sample.length * MAJORITY)) return fp;
        } catch { /* not a valid selector */ }
    }
    return null;
}

function depthOf(el: Element): number {
    let d = 0;
    for (let p = el.parentElement; p; p = p.parentElement) d++;
    return d;
}

function lowestCommonAncestor(els: Element[]): HTMLElement {
    let lca: Element = els[0].parentElement ?? els[0];
    for (const el of els.slice(1)) while (!lca.contains(el)) lca = lca.parentElement ?? lca;
    return lca as HTMLElement;
}

/** What makes two layout parents "alike": tag, author hooks and naming classes. */
function parentKey(el: Element): string {
    const hooks = AUTHOR_ATTRIBUTES.map(a => el.getAttribute(a)).filter(Boolean).join('|');
    const classes = Array.from(el.classList).filter(c => isNamingClass(c)).sort().join('.');
    return `${el.tagName}|${hooks}|${classes}`;
}

function sponsoredSignal(el: Element): boolean {
    const attrs = ['id', 'class', 'data-testid', 'data-test-id', 'aria-label', 'data-component-type', 'data-component'];
    return attrs.some(a => SPONSORED.test(el.getAttribute(a) || ''));
}

/** A short "Sponsored" label element, outside the items. */
function isSponsoredLabel(el: Element, items: HTMLElement[]): boolean {
    const text = (el.textContent || '').trim();
    return text.length < 40 && SPONSORED_TEXT.test(text) && !items.some(i => i.contains(el));
}

function kindOf(group: { container: HTMLElement; items: HTMLElement[] }): GroupKind {
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

/** Tag counts of an item's subtree, compared to tell like items from unlike ones with the same class. */
function shape(el: Element): Map<string, number> {
    const counts = new Map<string, number>();
    const all = el.querySelectorAll('*');
    for (let i = 0; i < Math.min(all.length, 300); i++) counts.set(all[i].tagName, (counts.get(all[i].tagName) ?? 0) + 1);
    return counts;
}

function similarity(a: Map<string, number>, b: Map<string, number>): number {
    let dot = 0, na = 0, nb = 0;
    for (const [k, v] of a) { dot += v * (b.get(k) ?? 0); na += v * v; }
    for (const v of b.values()) nb += v * v;
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Groups of `matches` by region, in document order. */
function groupByRegion(matches: HTMLElement[]): { container: HTMLElement; items: HTMLElement[] }[] {
    const parents = [...new Set(matches.map(m => m.parentElement!))];
    const root = new Map<Element, Element>(parents.map(p => [p, p]));
    const find = (p: Element): Element => (root.get(p) === p ? p : (root.set(p, find(root.get(p)!)), root.get(p)!));
    const byKey = new Map<string, Element[]>();
    for (const p of parents) byKey.set(parentKey(p), [...(byKey.get(parentKey(p)) ?? []), p]);
    for (const same of byKey.values()) {
        for (let i = 1; i < same.length; i++) {
            const [a, b] = [same[i - 1], same[i]];
            const lca = lowestCommonAncestor([a, b]);
            if (depthOf(a) - depthOf(lca) <= MERGE_LEVELS && depthOf(b) - depthOf(lca) <= MERGE_LEVELS) root.set(find(a), find(b));
        }
    }
    const groups = new Map<Element, HTMLElement[]>();
    for (const m of matches) {
        const g = find(m.parentElement!);
        groups.set(g, [...(groups.get(g) ?? []), m]);
    }
    return [...groups.values()].map(items => ({ container: items.length > 1 ? lowestCommonAncestor(items) : items[0].parentElement as HTMLElement, items }));
}

/**
 * The item set for a list found by `findList` around `clicked`. Falls back to the list as found
 * when nothing names its items.
 */
export function expandItemSet(match: ListMatch, clicked: Element): ItemSet {
    const single: ItemSet = match.container
        ? { ...match, groups: [{ container: match.container, items: match.siblings, kind: 'results' }], chosen: 0, clicked: 0 }
        : { ...match, groups: [], chosen: -1, clicked: -1 };
    if (!match.isContainer || !match.container || match.siblings.length === 0) return single;

    const reference = match.siblings.find(s => s.contains(clicked) || clicked.contains(s)) ?? match.siblings[0];
    const fingerprint = itemFingerprint(match.siblings, reference) ?? coreFingerprint(match.siblings, reference);
    if (!fingerprint) return single;

    let matches: HTMLElement[];
    try { matches = Array.from(document.querySelectorAll<HTMLElement>(fingerprint)).slice(0, MAX_MATCHES); } catch { return single; }
    const set = new Set<Element>(matches);
    matches = matches.filter(m => { for (let p = m.parentElement; p; p = p.parentElement) if (set.has(p)) return false; return true; });
    if (matches.length < 2) return single;

    const own = matches.find(m => m.contains(clicked) || clicked.contains(m));
    const ownShape = shape(own ?? matches[0]);
    const groups: ItemGroup[] = groupByRegion(matches)
        .filter(g => g.items.length >= 2 || g.items.includes(own as HTMLElement))
        // A class reused by unlike things (a nav item and a product card) is another list, not this one.
        .filter(g => g.items.includes(own as HTMLElement) || similarity(shape(g.items[0]), ownShape) >= 0.6)
        .map(g => ({ ...g, kind: kindOf(g), heading: headingOf(g.container) }));
    if (groups.length === 0) return single;

    const clickedIndex = Math.max(0, groups.findIndex(g => own && g.items.includes(own)));
    let chosen = clickedIndex;
    if (groups[clickedIndex].kind !== 'results') {
        // A sponsored shelf or a carousel above the results: the results are what was meant.
        const results = groups.map((g, i) => [g, i] as const).filter(([g]) => g.kind === 'results').sort((a, b) => b[0].items.length - a[0].items.length)[0];
        if (results && results[0].items.length > groups[clickedIndex].items.length) chosen = results[1];
    }
    const g = groups[chosen];
    return {
        isContainer: true,
        containerType: match.containerType,
        container: g.container,
        siblings: g.items,
        childCount: g.items.length,
        groups,
        chosen,
        clicked: clickedIndex,
    };
}
