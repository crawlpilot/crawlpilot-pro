/**
 * Selectors for one element: a CSS path, a positional XPath, and graded candidates from several
 * strategies (stable id, semantic attributes, classes, css-selector-generator, paths).
 */
import { cssSelectorGenerator } from 'css-selector-generator';
import { looksLikeXPath } from '../../../shared/selectors/resolve';
import {
    AUTHOR_ATTRIBUTES, isStableAttributeValue, isStableId, isUnstableClass, isUtilityByFrequency, STATE_ATTRIBUTES, xpathLiteral,
} from '../../../shared/selectors/stability';

/** The element's classes a selector may name it by: no utilities (by name or by spread), no state. */
function stableClasses(el: Element): string[] {
    const raw = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
    return raw.split(/\s+/).filter(c => c && !isUnstableClass(c) && !isUtilityByFrequency(c, el.ownerDocument ?? document));
}

/** `[attr="value"]` with the value escaped for CSS. */
function cssAttr(attr: string, value: string): string {
    return `[${attr}="${value.replace(/["\\]/g, '\\$&')}"]`;
}

/**
 * An attribute part `css-selector-generator` may use: no state attribute even as presence, no
 * instance or unstable value (`[data-item-id='7BZ…']`, `[href='/p/1']`).
 */
function blockedAttributePart(part: string): boolean {
    const m = /^\[([\w-]+)(?:[~|^$*]?=(['"]?)(.*)\2)?\]$/.exec(part);
    if (!m) return false;
    const [, attr, , value] = m;
    if (STATE_ATTRIBUTES.has(attr)) return true;
    return value !== undefined && !isStableAttributeValue(attr, value.replace(/\\(.)/g, '$1'));
}

const WHITELISTED_PART = new RegExp(`^\\[(${[...AUTHOR_ATTRIBUTES, 'role', 'aria-label', 'name'].join('|')})[=\\]]`);

/** A class part the page uses as a utility (`.normal`, `.dark-gray`). */
function blockedClassPart(part: string): boolean {
    const m = /^\.((?:\\.|[\w-])+)$/.exec(part);
    if (!m) return false;
    const cls = m[1].replace(/\\(.)/g, '$1');
    return isUnstableClass(cls) || isUtilityByFrequency(cls);
}

export function generateCssSelector(el: HTMLElement, generalized: boolean = false): string {
    if (!el || !el.tagName) return '';

    // 1. ID (Strongest) - Only use if NOT generalized
    if (!generalized && isStableId(el.id)) {
        try {
            const escapedId = CSS.escape(el.id);
            if (document.querySelectorAll(`#${escapedId}`).length === 1) {
                return `#${escapedId}`;
            }
        } catch (e) {
            // Ignore invalid IDs if CSS.escape fails or selector is still bad
        }
    }

    // 2. Path-based generation
    const path: string[] = [];
    let current: HTMLElement | null = el;
    let depth = 0;

    while (current && current !== document.body && depth < 10) {
        let selector = current.tagName.toLowerCase();

        // Add classes if available
        const classes = stableClasses(current);
        if (classes.length > 0) selector += `.${CSS.escape(classes[0])}`;

        if (current.parentElement && !generalized) {
            const siblings = Array.from(current.parentElement.children);
            const sameTagSiblings = siblings.filter(s => s.tagName === current!.tagName);

            if (sameTagSiblings.length > 1) {
                const index = sameTagSiblings.indexOf(current);
                selector += `:nth-of-type(${index + 1})`;
            }
        }

        path.unshift(selector);
        current = current.parentElement;
        depth++;
    }

    return path.join(' > ');
}

export function generateXPath(element: HTMLElement): string {
    if (!element || element.nodeType !== 1) return '';

    // 1. If element has ID, use it for shortest path (IF STABLE)
    if (isStableId(element.id)) {
        return `//*[@id=${xpathLiteral(element.id)}]`;
    }

    // 2. Iterative path generation
    const paths: string[] = [];
    let current: HTMLElement | null = element;

    while (current && current.nodeType === 1) {
        // If we hit an element with ID during ascent, use it as anchor (IF STABLE)
        if (isStableId(current.id)) {
            paths.unshift(`*[@id=${xpathLiteral(current.id)}]`);
            return '//' + paths.join('/');
        }

        if (current === document.body) {
            paths.unshift('html', 'body');
            return '/' + paths.join('/');
        }

        let index = 0;
        const tagName = current.tagName.toLowerCase();

        // Count previous siblings with same tag
        let sibling = current.previousElementSibling;
        while (sibling) {
            if (sibling.tagName.toLowerCase() === tagName) {
                index++;
            }
            sibling = sibling.previousElementSibling;
        }

        paths.unshift(`${tagName}[${index + 1}]`);
        current = current.parentElement;
    }

    return paths.length ? '/' + paths.join('/') : '';
}

export interface SelectorResult {
    selector: string;
    strategy: string;
}

interface SelectorStrategy {
    name: string;
    generate(element: HTMLElement, options?: SelectorOptions): string[];
    priority: number; // Higher is better
}

export interface SelectorOptions {
    root?: HTMLElement;
    isList?: boolean;
}

class IdSelectorStrategy implements SelectorStrategy {
    name = 'ID';
    priority = 110;
    generate(element: HTMLElement, options?: SelectorOptions): string[] {
        if (options?.isList) return []; // IDs are usually unique, don't use for list items

        const id = element.id;
        if (!isStableId(id)) return [];

        const sel = `#${CSS.escape(id)}`;
        return document.querySelectorAll(sel).length === 1 ? [sel] : [];
    }
}


/**
 * Tries the element's own tag + semantic class/attribute without any ancestor chain.
 * If the resulting selector is unique within root, it's the shortest stable selector possible.
 */
class MinimalSelectorStrategy implements SelectorStrategy {
    name = 'Minimal';
    priority = 115;

    generate(element: HTMLElement, options?: SelectorOptions): string[] {
        const root: Element = options?.root || document.body;
        const tag = element.tagName.toLowerCase();
        const results: string[] = [];

        // 1. Semantic attributes directly on the element (stable values only)
        for (const attr of [...AUTHOR_ATTRIBUTES, 'role', 'aria-label', 'name']) {
            const val = element.getAttribute(attr);
            if (val && isStableAttributeValue(attr, val)) {
                const sel = `${tag}${cssAttr(attr, val)}`;
                if (this.isUnique(sel, root)) { results.push(sel); break; }
                const noTagSel = cssAttr(attr, val);
                if (this.isUnique(noTagSel, root)) { results.push(noTagSel); break; }
            }
        }

        // 2. tag + semantic class(es) — no ancestor context
        const classes = stableClasses(element).map(c => CSS.escape(c));

        if (classes.length > 0) {
            const full = `${tag}.${classes.join('.')}`;
            if (this.isUnique(full, root)) results.push(full);
            for (const c of classes) {
                const single = `${tag}.${c}`;
                if (this.isUnique(single, root)) { results.push(single); break; }
            }
        }

        // 3. Ancestor prefix fallback — when tag.class alone isn't unique (e.g. hidden DOM copies)
        if (results.length === 0 && classes.length > 0) {
            const withAncestor = this.tryWithSemanticAncestor(element, tag, classes, root);
            if (withAncestor) results.push(withAncestor);
        }

        return results;
    }

    private tryWithSemanticAncestor(element: HTMLElement, tag: string, classes: string[], root: Element): string | null {
        const targetClasses = classes.slice(0, 3);
        let ancestor = element.parentElement;
        for (let depth = 0; depth < 3 && ancestor && ancestor !== root; depth++) {
            for (const ac of stableClasses(ancestor).map(c => CSS.escape(c)).slice(0, 5)) {
                for (const c of targetClasses) {
                    const sel = `.${ac} ${tag}.${c}`;
                    try { if (root.querySelectorAll(sel).length === 1) return sel; } catch { }
                }
            }
            ancestor = ancestor.parentElement;
        }
        return null;
    }

    private isUnique(sel: string, root: Element): boolean {
        try { return root.querySelectorAll(sel).length === 1; } catch { return false; }
    }
}


class GeneratorLibraryStrategy implements SelectorStrategy {
    name = 'CSS Gen';
    priority = 70;

    generate(element: HTMLElement, options?: SelectorOptions): string[] {
        try {
            const root = options?.root || document.body;
            const genOptions: any = {
                root,
                // Semantic types first — attribute ([data-*]) beats class beats tag
                selectors: options?.isList
                    ? ['attribute', 'class', 'tag']
                    : ['id', 'attribute', 'class', 'tag', 'nthchild'],

                // Ranked first, and kept even when a blacklist rule matches (the library lets the
                // whitelist win), so only author hooks with stable values belong here.
                whitelist: [(part: string) => WHITELISTED_PART.test(part) && !blockedAttributePart(part)],

                // Block unstable class patterns — function form checks anywhere in selector string
                blacklist: [
                    blockedAttributePart,
                    blockedClassPart,
                    // Tailwind JIT / v4 arbitrary classes appear CSS-escaped as .\[...\] or .\(...\)
                    (sel: string) => /\\\[/.test(sel),  // e.g. .\[--border-width\:1px\]
                    (sel: string) => /\\\(/.test(sel),  // e.g. .\(--border-width\)
                    (sel: string) => /\\\*/.test(sel),  // e.g. .\*\:-m-
                    (sel: string) => /[_-][a-z]{1,4}\d{2,}/.test(sel),      // versioned slugs (ss26, ab12) anywhere
                    (sel: string) => /\blayout-/.test(sel),                   // layout-* anywhere
                    (sel: string) => /^[a-z]{2,4}-(layout|container|wrapper|main|content|page|section|view)/.test(sel), // design system prefixes
                    (sel: string) => /-(desktop|mobile|tablet|std|alt|compact|wide|narrow)(-|$)/.test(sel), // variant suffixes
                    /^\.[a-z]{1,3}-\d/,                        // w-4, h-8, p-2
                    /^\.[mp][xytrbl]?-/,                       // mx-, py-
                    /^\.(flex|grid|block|inline|hidden|visible|overflow|static|fixed|absolute|relative|sticky)(-|$)/,
                    /^\.(bg-|border-|rounded|ring|shadow|opacity|text-[a-z]+-?\d|gap-|space-)(-|$)/,
                    /^\.(transition|animate|scale|rotate|translate|transform)(-|$)/,
                    /^\.(sc-|css-)/,                           // styled-components / CSS modules
                    /^\.(hover|focus|active|group|peer)(-|$)/, // state/group utilities
                ],

                combineWithinSelector: true,
                combineBetweenSelectors: true,
                // Cap exponential growth on Tailwind-heavy pages
                maxCombinations: 50,
                maxCandidates: 150,
            };

            // cssSelectorGenerator yields candidates simplest → most complex.
            // Collect up to 10, score each, return sorted so generateAll picks the best.
            const candidates: string[] = [];
            for (const sel of cssSelectorGenerator(element, genOptions)) {
                candidates.push(sel);
                if (candidates.length >= 10) break;
            }

            return candidates.sort((a, b) => this.scoreSelector(b) - this.scoreSelector(a));
        } catch {
            return [];
        }
    }

    private scoreSelector(sel: string): number {
        let score = 100;
        // Penalise ancestor depth
        score -= (sel.match(/>/g) || []).length * 15;
        // Penalise positional selectors
        if (sel.includes(':nth-child') || sel.includes(':nth-of-type')) score -= 20;
        // Reward semantic attributes
        if (sel.includes('[data-')) score += 30;
        if (sel.includes('[role') || sel.includes('[aria-')) score += 20;
        if (sel.includes('#')) score += 25;
        // Penalise long selectors
        score -= Math.max(0, sel.length - 40) * 0.5;
        return score;
    }
}

class SemanticXPathStrategy implements SelectorStrategy {
    name = 'Semantic XPath';
    priority = 106;

    generate(element: HTMLElement, options?: SelectorOptions): string[] {
        if (options?.isList) return []; // CommonSelectorGenerator handles XPath for list items
        const tag = element.tagName.toLowerCase();
        const results: string[] = [];

        // 1. Stable attribute XPath
        for (const attr of [...AUTHOR_ATTRIBUTES, 'role', 'name', 'type']) {
            const val = element.getAttribute(attr);
            if (val && isStableAttributeValue(attr, val)) {
                const sel = `//${tag}[@${attr}=${xpathLiteral(val)}]`;
                if (this.isUnique(sel)) { results.push(sel); return results; }
            }
        }

        // 2. Class-based XPath — contains(concat(...)) prevents partial class name matches
        const classes = stableClasses(element).slice(0, 5);
        for (const cls of classes) {
            const sel = `//${tag}[contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')]`;
            if (this.isUnique(sel)) { results.push(sel); return results; }
        }

        // 3. Ancestor prefix fallback when no single class is globally unique
        let ancestor = element.parentElement;
        for (let depth = 0; classes.length > 0 && depth < 3 && ancestor && ancestor !== document.body; depth++) {
            const atag = ancestor.tagName.toLowerCase();
            for (const ac of stableClasses(ancestor).slice(0, 5)) {
                for (const cls of classes.slice(0, 3)) {
                    const sel = `//${atag}[contains(concat(' ', normalize-space(@class), ' '), ' ${ac} ')]//${tag}[contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')]`;
                    if (this.isUnique(sel)) { results.push(sel); return results; }
                }
            }
            ancestor = ancestor.parentElement;
        }

        return results;
    }

    private isUnique(sel: string): boolean {
        try {
            const result = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            return result.snapshotLength === 1;
        } catch { return false; }
    }
}

class XPathStrategy implements SelectorStrategy {
    name = 'XPath';
    priority = 50;
    generate(element: HTMLElement): string[] {
        const xpath = generateXPath(element);
        return xpath ? [xpath] : [];
    }
}

class AttributeStrategy implements SelectorStrategy {
    name = 'Attribute';
    priority = 108;
    generate(element: HTMLElement): string[] {
        const results: string[] = [];
        const attributes = [...AUTHOR_ATTRIBUTES, 'name', 'role', 'aria-label', 'title', 'rel', 'type'];

        const tag = element.tagName.toLowerCase();
        for (const attr of attributes) {
            const val = element.getAttribute(attr);
            if (val !== null && isStableAttributeValue(attr, val)) {
                results.push(cssAttr(attr, val));
                results.push(`${tag}${cssAttr(attr, val)}`);
            }
            // Unstable values: skip entirely — [attr] presence selectors match too broadly
        }
        return results;
    }
}

class PathSelectorStrategy implements SelectorStrategy {
    name = 'Path';
    priority = 65;
    generate(element: HTMLElement): string[] {
        const results: string[] = [];
        const specific = generateCssSelector(element, false);
        const generalized = generateCssSelector(element, true);
        if (specific) results.push(specific);
        if (generalized && generalized !== specific) results.push(generalized);
        return results;
    }
}

class SelectorGenerator {
    private strategies: SelectorStrategy[] = [
        new MinimalSelectorStrategy(),    // 115 — shortest unique tag+class, no ancestors
        new IdSelectorStrategy(),          // 110 — stable IDs
        new AttributeStrategy(),           // 108 — data-*, aria-*, role
        new SemanticXPathStrategy(),       // 106 — class/attribute XPath
        new GeneratorLibraryStrategy(),   // 70  — css-selector-generator with filter+score
        new PathSelectorStrategy(),        // 65  — path-based CSS fallback
        new XPathStrategy()               // 50  — positional XPath fallback
    ];

    public generateAll(element: HTMLElement, options?: SelectorOptions): SelectorResult[] {
        const results: SelectorResult[] = [];
        const seen = new Set<string>();
        const root: Element = options?.root || document.body;
        let hasCss = false;
        let hasXPath = false;

        const sorted = [...this.strategies].sort((a, b) => b.priority - a.priority);

        for (const strategy of sorted) {
            // Once we have both CSS + XPath from high-quality strategies (priority ≥ 70),
            // skip the remaining fallback strategies (PathSelector 65, XPath 50).
            if (hasCss && hasXPath && strategy.priority < 70) break;

            const candidates = strategy.generate(element, options);
            for (const selector of candidates) {
                if (!selector || seen.has(selector)) continue;
                const trimmed = this.shortenSelector(selector, root);
                if (seen.has(trimmed)) { seen.add(selector); continue; }
                seen.add(trimmed);
                seen.add(selector);
                const isXPath = looksLikeXPath(trimmed);

                // In non-list mode, reject CSS selectors that aren't unique within root.
                // This prevents generic selectors like [aria-label] or [role="img"] from
                // being used when they match multiple elements on the page.
                if (!isXPath && !options?.isList) {
                    try {
                        if (root.querySelectorAll(trimmed).length !== 1) continue;
                    } catch { continue; }
                }

                results.push({ selector: trimmed, strategy: strategy.name });
                if (isXPath) hasXPath = true; else hasCss = true;
            }
        }

        return results;
    }

    /**
     * Strips ancestor segments from the left of a ">" chain until the shortest
     * form that still uniquely matches within root is found.
     */
    private shortenSelector(selector: string, root: Element): string {
        if (!selector.includes('>')) return selector;
        const parts = selector.split(/\s*>\s*/);
        for (let i = 1; i < parts.length; i++) {
            const shorter = parts.slice(i).join(' > ');
            try {
                if (root.querySelectorAll(shorter).length === 1) return shorter;
            } catch { /* invalid intermediate — keep going */ }
        }
        return selector;
    }
}

const generator = new SelectorGenerator();

/** Selector candidates for an element, best first. `isList`: candidates that match every item of a list. */
export function generateRobustSelectors(element: HTMLElement, options?: SelectorOptions): SelectorResult[] {
    return generator.generateAll(element, options);
}
