import { sanitizeCssSelector } from './sanitize';

/** True if a selector string looks like an XPath expression rather than CSS. */
export function looksLikeXPath(value: string): boolean {
    return value.startsWith('/') || value.startsWith('(') || value.startsWith('./') || value.startsWith('id(');
}

/** Every element a selector matches under `root` (CSS or XPath); none when it doesn't parse. */
function queryAll(selector: string, root: ParentNode): Element[] {
    try {
        if (looksLikeXPath(selector)) {
            const doc = root.ownerDocument ?? (root as unknown as Document);
            const result = doc.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const out: Element[] = [];
            for (let i = 0; i < result.snapshotLength; i++) {
                const node = result.snapshotItem(i);
                if (node instanceof Element) out.push(node);
            }
            return out;
        }
        return Array.from(root.querySelectorAll(sanitizeCssSelector(selector)));
    } catch {
        return [];
    }
}

/** A chain as callers hold it: CSS or XPath strings, best first. */
type Chain = readonly string[];

/** Which entry of the chain answered (0 = the primary; > 0 = a fallback), or -1 when none did. */
export interface Resolution<T> {
    result: T;
    used: number;
}

const rendered = (el: Element) => el.getClientRects().length > 0;

/**
 * One element: the first entry that matches exactly one; failing that, the first entry that
 * matches several, and its first rendered match (a control and its sticky copy).
 */
export function resolveOne(chain: Chain, root: ParentNode = document): Resolution<Element | null> {
    let several: Resolution<Element | null> | null = null;
    for (let i = 0; i < chain.length; i++) {
        const matches = queryAll(chain[i], root);
        if (matches.length === 1) return { result: matches[0], used: i };
        if (matches.length > 1 && !several) several = { result: matches.find(rendered) ?? matches[0], used: i };
    }
    return several ?? { result: null, used: -1 };
}

/** Items under `container`: the first entry that matches any (an empty page has none). */
export function resolveItems(chain: Chain, container: ParentNode): Resolution<Element[]> {
    for (let i = 0; i < chain.length; i++) {
        const matches = queryAll(chain[i], container);
        if (matches.length > 0) return { result: matches, used: i };
    }
    return { result: [], used: -1 };
}

/**
 * A list's container: the first entry whose element holds at least two of the list's items (by
 * `items`), so a stale entry that now matches some other element is passed over. Without an item
 * chain, the first entry that matches.
 */
export function resolveContainer(chain: Chain, items: Chain, root: ParentNode = document): Resolution<HTMLElement | null> {
    const itemChain = items;
    let first: Resolution<HTMLElement | null> | null = null;
    for (let i = 0; i < chain.length; i++) {
        for (const candidate of queryAll(chain[i], root)) {
            first ??= { result: candidate as HTMLElement, used: i };
            if (itemChain.length === 0) return first;
            if (resolveItems(itemChain, candidate).result.length >= 2) return { result: candidate as HTMLElement, used: i };
        }
    }
    return first ?? { result: null, used: -1 };
}
