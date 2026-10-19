import { ChainEntry, RawChainEntry } from './types';
import { sanitizeCssSelector } from './sanitize';

/** True if a selector string looks like an XPath expression rather than CSS. */
export function looksLikeXPath(value: string): boolean {
    return value.startsWith('/') || value.startsWith('(') || value.startsWith('./') || value.startsWith('id(');
}

/**
 * Normalizes any of the selector-chain shapes used across the codebase
 * (SelectorMetadata {selector,strategy}, SelectorDefinition {value,type}, or a bare string)
 * into a single ChainEntry[] the resolver can walk in order.
 */
export function normalizeChain(entries: (RawChainEntry | null | undefined)[] | null | undefined): ChainEntry[] {
    if (!entries) return [];
    const out: ChainEntry[] = [];
    for (const entry of entries) {
        if (!entry) continue;
        if (typeof entry === 'string') {
            if (!entry) continue;
            out.push({ value: entry, kind: looksLikeXPath(entry) ? 'xpath' : 'css' });
            continue;
        }
        if ('selector' in entry) {
            if (!entry.selector) continue;
            out.push({
                value: entry.selector,
                kind: looksLikeXPath(entry.selector) ? 'xpath' : 'css',
                strategy: entry.strategy,
            });
            continue;
        }
        if ('value' in entry) {
            if (!entry.value) continue;
            const kind = entry.type === 'xpath' ? 'xpath'
                : entry.type === 'css' || entry.type === 'id' ? 'css'
                : looksLikeXPath(entry.value) ? 'xpath' : 'css';
            out.push({ value: entry.value, kind });
        }
    }
    return out;
}

function queryAll(entry: ChainEntry, root: ParentNode): Element[] {
    try {
        if (entry.kind === 'xpath') {
            const doc = root.ownerDocument ?? (root as unknown as Document);
            const result = doc.evaluate(entry.value, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const out: Element[] = [];
            for (let i = 0; i < result.snapshotLength; i++) {
                const node = result.snapshotItem(i);
                if (node instanceof Element) out.push(node);
            }
            return out;
        }
        return Array.from(root.querySelectorAll(sanitizeCssSelector(entry.value)));
    } catch {
        return [];
    }
}

type RawChain = (RawChainEntry | null | undefined)[] | null | undefined;

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
export function resolveOne(entries: RawChain, root: ParentNode = document): Resolution<Element | null> {
    const chain = normalizeChain(entries);
    let several: Resolution<Element | null> | null = null;
    for (let i = 0; i < chain.length; i++) {
        const matches = queryAll(chain[i], root);
        if (matches.length === 1) return { result: matches[0], used: i };
        if (matches.length > 1 && !several) several = { result: matches.find(rendered) ?? matches[0], used: i };
    }
    return several ?? { result: null, used: -1 };
}

/** Items under `container`: the first entry that matches any (an empty page has none). */
export function resolveItems(entries: RawChain, container: ParentNode): Resolution<Element[]> {
    const chain = normalizeChain(entries);
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
export function resolveContainer(entries: RawChain, items: RawChain, root: ParentNode = document): Resolution<HTMLElement | null> {
    const chain = normalizeChain(entries);
    const itemChain = normalizeChain(items);
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
