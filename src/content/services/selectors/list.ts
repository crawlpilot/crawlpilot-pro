/**
 * The selectors a picked list stores: one chain for its container, one for its items.
 *
 * Items first. `keepItems` decides which children are items (cards, rows; not headers, ads or
 * widgets). Candidates are proposed from the cheapest evidence up — an author hook on the item, a
 * hook on one of its children (`:has`), a shared class, the bare tag — and a candidate is kept only
 * when it matches **exactly** the items under the container: no more (nested elements, ad blocks),
 * no fewer. The chain holds at most three entries from different families, one of them a relative
 * XPath, so CSS and XPath fail independently.
 *
 * The container is named without positions. When the list's own element can't be named (a bare
 * `div`), the nearest ancestor that can is the container, and the items are matched under it.
 */
import { generateCssSelector, generateRobustSelectors } from './generate';
import { keepItems } from '../extraction/items';
import { looksLikeXPath } from '../../../shared/selectors/resolve';
import { selectorCost, selectorFamily } from '../../../shared/selectors/grade';
import {
    AUTHOR_ATTRIBUTES, isNamingClass, isStableAttributeValue, isVolatileSelector, STATE_ATTRIBUTES, xpathLiteral,
} from '../../../shared/selectors/stability';

export interface ChainEntry {
    selector: string;
    /** The family of evidence it rests on (`author`, `child hook`, `class`, `structure`, `xpath`). */
    strategy: string;
}

export interface ListLocators {
    container: ChainEntry[];
    items: ChainEntry[];
}

interface Candidate {
    css: string;
    /** The same test as a container-relative XPath, when it has one. */
    xpath?: string;
    family: string;
    cost: number;
}

const MAX_CHAIN = 3;
/** How far up the container may move to find a name. */
const MAX_CONTAINER_LEVELS = 4;
/** Items and descendants looked at when collecting child hooks (the exactness check covers all items). */
const FEATURE_ITEMS = 20;
const FEATURE_NODES = 150;
const MAX_CHILD_HOOKS = 8;
/** Attributes whose presence marks an item (a product, a listing), whatever their per-item value. */
const IDENTITY = /^data-(.+[-_])?(id|sku|asin|key|guid|uuid|urn|pid)$/;
const AUTHOR = new Set<string>(AUTHOR_ATTRIBUTES);
const NAMING_ATTRIBUTES = [...AUTHOR_ATTRIBUTES, 'role', 'aria-label', 'name'];
const CLASS_TEST = (c: string) => `contains(concat(' ', normalize-space(@class), ' '), ' ${c} ')`;

function cssAttr(attr: string, value?: string): string {
    return value === undefined ? `[${attr}]` : `[${attr}="${value.replace(/["\\]/g, '\\$&')}"]`;
}

function xpathAttr(attr: string, value?: string): string {
    return value === undefined ? `@${attr}` : `@${attr}=${xpathLiteral(value)}`;
}

function query(root: Element, selector: string): Element[] {
    try {
        if (looksLikeXPath(selector)) {
            const r = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            return Array.from({ length: r.snapshotLength }, (_, i) => r.snapshotItem(i) as Element);
        }
        return Array.from(root.querySelectorAll(selector));
    } catch {
        return [];
    }
}

function exact(root: Element, selector: string, items: Set<Element>): boolean {
    // Cheap first: every item must match the selector itself (most candidates fail here).
    if (!looksLikeXPath(selector)) {
        const direct = selector.startsWith(':scope > ');
        const own = direct ? selector.slice(':scope > '.length) : selector;
        try {
            for (const item of items) if ((direct && item.parentElement !== root) || !item.matches(own)) return false;
        } catch {
            return false;
        }
    }
    // Direct-children forms only need the root's children, not a search of the whole subtree.
    const matched = selector.startsWith(':scope > ')
        ? Array.from(root.children).filter(c => c.matches(selector.slice(':scope > '.length)))
        : query(root, selector);
    return matched.length === items.size && matched.every(el => items.has(el));
}

/** Attributes worth testing on an element: author hooks, naming attributes, and its other `data-*`. */
function attributeNames(el: Element): string[] {
    const data = el.getAttributeNames().filter(n => n.startsWith('data-') && !STATE_ATTRIBUTES.has(n) && !AUTHOR.has(n));
    return [...NAMING_ATTRIBUTES, ...data].filter(n => el.hasAttribute(n));
}

/**
 * `[attr="value"]` when every element has the same stable value, `[attr]` when they all have it
 * with their own values (an item id is a fine *presence* test), or nothing.
 */
function sharedAttribute(els: Element[], attr: string): { css: string; xpath: string; cost: number } | null {
    const values = els.map(e => e.getAttribute(attr));
    if (values.some(v => v === null)) return null;
    const first = values[0]!;
    const named = AUTHOR.has(attr);
    if (values.every(v => v === first) && isStableAttributeValue(attr, first)) {
        return { css: cssAttr(attr, first), xpath: xpathAttr(attr, first), cost: named ? 100 : 350 };
    }
    if (attr === 'role' || attr === 'aria-label' || attr === 'name' || first === '') return null;
    return { css: cssAttr(attr), xpath: xpathAttr(attr), cost: named ? 200 : 300 };
}

/** Features every sampled item has on a child (`> […]`) or deeper: `:has()` tests. */
function childHooks(items: Element[]): { css: string; xpath: string; cost: number }[] {
    const sample = items.slice(0, FEATURE_ITEMS);
    const out: { css: string; xpath: string; cost: number }[] = [];
    const seen = new Set<string>();
    for (const direct of [true, false]) {
        const nodes = sample.map(item => direct
            ? Array.from(item.children)
            : Array.from(item.querySelectorAll('*')).slice(0, FEATURE_NODES));
        for (const node of nodes[0]) {
            // Author hooks and identity attributes only: a child's other data-* say little about the item.
            for (const attr of attributeNames(node).filter(a => AUTHOR.has(a) || IDENTITY.test(a))) {
                // The same attribute on a node of the same tag in every item.
                const hits = nodes.map(list => list.find(n => n.tagName === node.tagName && n.hasAttribute(attr)));
                if (hits.some(h => !h)) continue;
                const shared = sharedAttribute(hits as Element[], attr);
                if (!shared || seen.has(shared.css)) continue;
                seen.add(shared.css);
                out.push({
                    css: `:has(${direct ? '> ' : ''}${shared.css})`,
                    xpath: direct ? `[*[${shared.xpath}]]` : `[.//*[${shared.xpath}]]`,
                    cost: shared.cost + (direct ? 80 : 120),
                });
            }
        }
    }
    return out.sort((a, b) => a.cost - b.cost).slice(0, MAX_CHILD_HOOKS);
}

function itemCandidates(items: Element[]): Candidate[] {
    const tags = new Set(items.map(i => i.tagName.toLowerCase()));
    const tag = tags.size === 1 ? [...tags][0] : '';
    const xtag = tag || '*';
    const out: Candidate[] = [];

    for (const attr of attributeNames(items[0])) {
        const shared = sharedAttribute(items, attr);
        if (shared) out.push({ css: `${tag}${shared.css}`, xpath: `./${xtag}[${shared.xpath}]`, family: AUTHOR.has(attr) ? 'author' : 'attribute', cost: shared.cost });
    }
    // Direct children only: a descendant `div:has(…)` also matches the wrappers inside each item.
    const hooks = childHooks(items).map(hook =>
        ({ css: `:scope > ${tag || '*'}${hook.css}`, xpath: `./${xtag}${hook.xpath}`, family: 'child hook', cost: hook.cost + 50 }));
    const classes = Array.from(items[0].classList).filter(c => isNamingClass(c) && items.every(i => i.classList.contains(c)));
    for (const c of classes) {
        out.push({ css: `${tag}.${CSS.escape(c)}`, xpath: `./${xtag}[${CLASS_TEST(c)}]`, family: 'class', cost: 400 });
    }
    if (tag) out.push({ css: tag, xpath: `./${tag}`, family: 'structure', cost: 600 });

    // Each also as direct children only, for when the plain form also matches nested elements.
    for (const c of [...out]) out.push({ ...c, css: `:scope > ${c.css}`, cost: c.cost + 50 });
    return [...out, ...hooks].sort((a, b) => a.cost - b.cost);
}

/** The item chain under `root`: exact candidates by cost, one per family, plus one relative XPath. */
function itemChain(root: Element, items: Element[]): ChainEntry[] {
    const set = new Set(items);
    const chain: ChainEntry[] = [];
    const families = new Set<string>();
    let xpath: string | undefined;
    for (const c of itemCandidates(items)) {
        if (chain.length >= MAX_CHAIN - 1 && xpath) break;
        if (families.has(c.family) || !exact(root, c.css, set)) continue;
        if (chain.length < MAX_CHAIN - 1) {
            chain.push({ selector: c.css, strategy: c.family });
            families.add(c.family);
        }
        // XPath children (`./x`) only exist under the list's own element.
        if (!xpath && c.xpath && items.every(i => i.parentElement === root) && exact(root, c.xpath, set)) xpath = c.xpath;
    }
    if (xpath) chain.push({ selector: xpath, strategy: 'xpath' });
    return chain;
}

const POSITIONAL = /:nth-(child|of-type)\(|\[\d+\]/;

/** The selector's last step carries a name (id, attribute, class), not just a tag under a named scope. */
function namesItself(selector: string): boolean {
    if (looksLikeXPath(selector)) return /\[[^\]]*[@(][^\]]*\]\s*$/.test(selector);
    const last = selector.trim().split(/\s*[>+~]\s*|\s+(?![^[(]*[\])])/).pop() ?? '';
    return /[#.[]/.test(last.replace(/^:scope/, ''));
}

/**
 * Selectors naming the element alone without positions, cheapest first: at most two CSS of
 * different families and one XPath.
 */
function containerChain(el: HTMLElement, ownName: boolean): ChainEntry[] {
    const named = generateRobustSelectors(el)
        .map(r => r.selector)
        .filter(s => !POSITIONAL.test(s) && !isVolatileSelector(s) && (!ownName || namesItself(s)))
        .filter(s => { const m = query(document.documentElement, s); return m.length === 1 && m[0] === el; })
        .sort((a, b) => selectorCost(a) - selectorCost(b));
    const css: ChainEntry[] = [];
    const families = new Set<string>();
    for (const s of named.filter(s => !looksLikeXPath(s))) {
        const family = selectorFamily(s);
        if (families.has(family) || css.length >= MAX_CHAIN - 1) continue;
        families.add(family);
        css.push({ selector: s, strategy: family });
    }
    const xpath = named.find(looksLikeXPath);
    return xpath ? [...css, { selector: xpath, strategy: 'xpath' }] : css;
}

/**
 * Container and item chains for a picked list. `children` are the container's candidate items
 * (headers and ads among them are left out by `keepItems`).
 */
export function listLocators(container: HTMLElement, children: HTMLElement[]): ListLocators {
    const items = keepItems(children);
    // A container named by its own id, attribute or class, moving up if needed; else any
    // position-free name (a unique bare tag) for the list's element or an ancestor.
    for (const ownName of [true, false]) {
        let root: HTMLElement | null = container;
        for (let level = 0; root && root !== document.body && level <= MAX_CONTAINER_LEVELS; level++, root = root.parentElement) {
            const named = containerChain(root, ownName);
            if (named.length === 0) continue;
            const chain = itemChain(root, items);
            if (chain.length > 0) return { container: named, items: chain };
        }
    }
    // Nothing names the list without positions: the list's own element, and its children by tag
    // (the saved row gate keeps headers and ads out of the rows).
    const tag = items[0].tagName.toLowerCase();
    return {
        container: [{ selector: generateCssSelector(container), strategy: 'path' }],
        items: [{ selector: `:scope > ${tag}`, strategy: 'structure' }],
    };
}
