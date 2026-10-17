/**
 * The pagination "Next" button: selector candidates when it is picked, and finding the best
 * clickable match among them on each page of a run.
 */
import { generateRobustSelectors, SelectorResult } from './generate';
import { isStableId, xpathLiteral } from '../../../shared/selectors/stability';
import { looksLikeXPath } from '../../../shared/selectors/resolve';


/**
 * Utility class for generating robust XPath selectors.
 * Focuses on semantic stability (IDs, text, attributes) rather than just structure.
 */
class XPathGenerator {

    /**
     * Generates a list of robust XPath selectors for a given element.
     * Prioritizes semantic attributes, text content, and stable classes.
     */
    public static generate(element: HTMLElement): Array<{ value: string, quality: number, type: string }> {
        const results: Array<{ value: string, quality: number, type: string }> = [];
        const tag = element.tagName.toLowerCase();

        // 1. Exact ID
        // [CHANGED] Stricter check for dynamic IDs
        if (isStableId(element.id)) {
            results.push({ value: `//*[@id=${xpathLiteral(element.id)}]`, quality: 100, type: 'ID' });
        }

        // 2. Semantic Text Content (High Priority for Buttons/Links)
        this.addTextSelectors(element, tag, results);

        // 3. Semantic Attributes (rel, aria-label, etc.)
        this.addAttributeSelectors(element, tag, results);

        // 4. Class Combinations
        this.addClassSelectors(element, tag, results);
        this.addClassCombinationSelectors(element, tag, results);

        // 5. Hierarchy (Parent Context)
        this.addParentDescendantSelectors(element, tag, results);

        // 6. Sibling Context (Previous label/header)
        this.addSiblingContextSelectors(element, tag, results);

        const uniqueResults: { value: string, quality: number, type: string }[] = [];

        results.forEach(r => {
            if (this.isUnique(r.value)) {
                uniqueResults.push(r);
            } else {
                // Selector matches multiple items.
                // 1. Try 'last()' - often the most relevant for pagination/lists (bottom of page)
                const lastXPath = `(${r.value})[last()]`;
                if (this.isUnique(lastXPath)) {
                    uniqueResults.push({
                        value: lastXPath,
                        quality: r.quality - 2, // Very slight penalty, last() is usually safe
                        type: `${r.type} (Last)`
                    });
                }

                // 2. Try '1' - Top of page
                const firstXPath = `(${r.value})[1]`;
                if (this.isUnique(firstXPath)) {
                    uniqueResults.push({
                        value: firstXPath,
                        quality: r.quality - 5, // Higher penalty than last() as top items can be hidden
                        type: `${r.type} (First)`
                    });
                }
            }
        });

        return uniqueResults.sort((a, b) => b.quality - a.quality);
    }

    private static addTextSelectors(element: HTMLElement, tag: string, results: any[]) {
        const text = element.textContent?.trim() || ''; // Use textContent to get all text
        // Limit text length to avoid fragile selectors on long paragraphs
        if (text && text.length > 0 && text.length < 50) { // increased limit slightly to cover verbose buttons
            const literal = xpathLiteral(text);

            // 1. Exact match using normalize-space(string())
            // string() converts the context node to string value, matching nested text which text() does not
            results.push({
                value: `//${tag}[normalize-space(string())=${literal}]`,
                quality: 95, // High quality, exact match
                type: 'Text Exact'
            });

            // 2. Contains match for Any short text (not just keywords)
            // This mirrors the "contains string XPath (most robust)" from reference
            if (text.length > 3) {
                results.push({
                    value: `//${tag}[contains(string(), ${literal})]`,
                    quality: 90, // High quality, robust against whitespace/nesting
                    type: 'Text Contains'
                });
            }

            // 3. Keyword Bonus (Prioritize slightly higher if it matches known pagination keywords)
            if (['next', 'more', 'load', 'previous', 'prev', '>', '»', 'arrow', 'right'].some(k => text.toLowerCase().includes(k))) {
                // We already added the selectors above, but we can add a specific one with slightly hacked quality
                // OR we just rely on the above.
                // Let's ensure we have a fallback for partial keyword match if exact fails
                // e.g. text is "Next Page >" and we just want to match "Next"

                const keywords = ['Next', 'next', 'More', 'more', 'Show more', 'Load more'];
                keywords.forEach(kw => {
                    if (text.includes(kw)) {
                        results.push({
                            value: `//${tag}[contains(string(), ${xpathLiteral(kw)})]`,
                            quality: 88,
                            type: 'Keyword Partial'
                        });
                    }
                });
            }
        }
    }

    private static addAttributeSelectors(element: HTMLElement, tag: string, results: any[]) {
        // Rel="next" (Golden standard for pagination)
        if (element.getAttribute('rel') === 'next') {
            results.push({ value: `//${tag}[@rel='next']`, quality: 95, type: 'Attribute (rel)' });
        }

        // Aria Label
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
            results.push({ value: `//${tag}[@aria-label=${xpathLiteral(ariaLabel)}]`, quality: 80, type: 'Attribute (aria)' });
        }

        // Title
        const title = element.getAttribute('title');
        if (title) {
            results.push({ value: `//${tag}[@title=${xpathLiteral(title)}]`, quality: 80, type: 'Attribute (title)' });
        }
    }

    private static addClassSelectors(element: HTMLElement, tag: string, results: any[]) {
        if (!element.className || typeof element.className !== 'string') return;

        const classes = element.className.split(/\s+/).filter(c => c.trim().length > 0);

        // Check for pagination specific classes
        const paginationClasses = classes.filter(c => {
            const lower = c.toLowerCase();
            return lower.includes('pagination') || lower.includes('next') || lower.includes('page');
        });

        // Specific class contains selector
        // //a[contains(@class, "pagination-next")]
        paginationClasses.forEach(cls => {
            results.push({
                value: `//${tag}[contains(@class, '${cls}')]`,
                quality: 70, // Bit lower than ID/Text but better than generic path
                type: 'Class Contains'
            });
        });

        // Combined meaningful classes
        if (classes.length > 0) {
            const classCondition = classes.map(c => `contains(@class, '${c}')`).join(' and ');
            // Only if not too many classes
            if (classes.length <= 3) {
                results.push({
                    value: `//${tag}[${classCondition}]`,
                    quality: 60,
                    type: 'Classes Combined'
                });
            }
        }
    }

    private static addClassCombinationSelectors(element: HTMLElement, tag: string, results: any[]) {
        if (!element.className || typeof element.className !== 'string') return;
        const classes = element.className.split(/\s+/).filter(c => c.trim().length > 0 && !c.match(/\d/)); // Ignore classes with numbers

        // Two-class combinations
        if (classes.length >= 2) {
            for (let i = 0; i < classes.length; i++) {
                for (let j = i + 1; j < classes.length; j++) {
                    const c1 = classes[i];
                    const c2 = classes[j];
                    results.push({
                        value: `//${tag}[contains(@class, '${c1}') and contains(@class, '${c2}')]`,
                        quality: 75,
                        type: 'Classes Combined (Pair)'
                    });
                }
            }
        }
    }

    private static addParentDescendantSelectors(element: HTMLElement, tag: string, results: any[]) {
        let parent = element.parentElement;
        let depth = 0;

        while (parent && parent !== document.body && depth < 3) {
            // Parent ID
            if (isStableId(parent.id)) {
                results.push({
                    value: `//*[@id=${xpathLiteral(parent.id)}]//${tag}`,
                    quality: 80, // Better than raw structure, worse than direct ID
                    type: 'Parent ID Descendant'
                });
            }

            // Parent Class (if specific)
            if (parent.className && typeof parent.className === 'string') {
                const pClasses = parent.className.split(/\s+/).filter(c => c.includes('container') || c.includes('wrapper') || c.includes('section') || c.includes('list'));
                pClasses.forEach(pc => {
                    results.push({
                        value: `//${parent!.tagName.toLowerCase()}[contains(@class, '${pc}')]//${tag}`,
                        quality: 60,
                        type: 'Parent Class Descendant'
                    });
                });
            }

            parent = parent.parentElement;
            depth++;
        }
    }

    private static addSiblingContextSelectors(element: HTMLElement, tag: string, results: any[]) {
        // Look for preceding sibling that might be a label
        let sibling = element.previousElementSibling;
        while (sibling) {
            if (sibling.tagName === 'LABEL' || sibling.tagName === 'H3' || sibling.tagName === 'H4' || (sibling.textContent && sibling.textContent.length < 20)) {
                const text = sibling.textContent?.trim();
                if (text) {
                    results.push({
                        value: `//${sibling.tagName.toLowerCase()}[contains(string(), ${xpathLiteral(text)})]/following-sibling::${tag}`,
                        quality: 70,
                        type: 'Sibling Context'
                    });
                    break; // Only use immediate or close context
                }
            }
            sibling = sibling.previousElementSibling;
        }
    }

    private static isUnique(xpath: string): boolean {
        try {
            const res = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            return res.snapshotLength === 1;
        } catch (e) {
            return false;
        }
    }
}

/** Selector candidates for a Next / Load more button: unique now, no page numbers, semantic first. */
class PaginationSelectors {
    /**
     * Generates a list of selectors specifically optimized for pagination/next buttons.
     * It uses the base strategies but strictly filters for uniqueness and adds semantic fallbacks.
     */
    generate(element: HTMLElement): SelectorResult[] {
        // 1. Get base candidates using robust strategies (OptimalSelect, CSS Gen, etc.)
        const candidates = generateRobustSelectors(element, { isList: false });

        // 2. Add manual semantic selectors commonly used for pagination
        this.addSemanticSelectors(element, candidates);

        // 3. Filter and Validate candidates
        // They MUST point to a unique element (the Next button) currently.
        const validResults: SelectorResult[] = [];
        const seen = new Set<string>();

        // We use NextButtonSelector logic to validate 'uniqueness' and 'clickability'
        // But NextButtonSelector.find runs locally. Here we are generating IN context likely.

        for (const cand of candidates) {
            if (seen.has(cand.selector)) continue;
            seen.add(cand.selector);

            // [FIX] BRITTLE SELECTOR PREVENTION
            // If the selector contains a quoted string with a digit (e.g. 'Go to page 2' or "[aria-label='next 2']"),
            // we MUST discard it because it will break on page 3!
            if (/('.*\d.*'|".*\d.*")/.test(cand.selector)) {
                continue;
            }

            // Validation: Must match exactly 1 element
            const isXPath = looksLikeXPath(cand.selector);
            if (this.validateUnique(cand.selector, isXPath)) {
                // If it passes simple uniqueness, we trust it enough to be in the list
                // Real-time validation happens via NextButtonSelector.find() later during execution
                validResults.push(cand);
            }
        }

        return validResults;
    }

    private addSemanticSelectors(element: HTMLElement, results: SelectorResult[]) {
        // Use external robust generator
        const robustXPaths = XPathGenerator.generate(element);

        // Filter out XPaths if we already have a GOOD semantic CSS equivalent.
        // e.g. if we have an ID-based XPath, but we already have an ID-based CSS selector in 'results',
        // we might prefer the CSS one if it's cleaner.

        // HOWEVER, the user specifically wants PRIORITY for semantic selectors like aria-label.
        // XPathGenerator generates these. But SelectorGenerator (base) also attempts them via AttributeStrategy.

        // Strategy: Add XPaths, but if an XPath is purely ID-based and we have a CSS ID match, skip it?
        // Actually, user wants "aria-label containing next".
        // SelectorGenerator's AttributeStrategy does EXACT match `[aria-label="val"]`.
        // XPathGenerator does EXACT match too.

        // We will insert them at the top, but we sort carefully.

        // Let's create a combined list and sort by "Quality" + "Type Preference".
        // CSS is preferred over XPath if qualities are equal.

        const semanticXPaths = robustXPaths.map(rx => ({
            selector: rx.value,
            strategy: `Semantic ${rx.type} (${rx.quality})`,
            quality: rx.quality,
            isXPath: true
        }));

        // Insert XPaths into the results list
        // We need to merge and re-sort or just unshift distinct ones.

        // Reverse iterate to unshift high quality first
        [...semanticXPaths].reverse().forEach(rx => {
            // If this is an ID selector, but we already have a specialized ID CSS selector...
            // Don't duplicate? 
            // Actually, prepending ensures it's tried first.

            // BUT, if the ID is ugly (numbers) and generated by fallback mechanism, maybe avoid?
            // XPathGenerator checks `!/\d/` for IDs.

            results.unshift({
                selector: rx.selector,
                strategy: rx.strategy
            });
        });

        // [FIX] Explicitly check for Aria-Label CSS opportunities that might be cleaner than XPath
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel && !/\d/.test(ariaLabel)) {
            // Add a very high priority CSS selector if simple AND DOES NOT CONTAIN NUMBERS (page numbers)
            const css = `[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
            results.unshift({
                selector: css,
                strategy: 'Semantic Attribute CSS (High Priority)'
            });
            // This will be at index 0 now, overriding the XPath
        }
    }

    private validateUnique(selector: string, isXPath: boolean): boolean {
        try {
            let count = 0;
            if (isXPath) {
                const res = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                count = res.snapshotLength;
            } else {
                count = document.querySelectorAll(selector).length;
            }

            if (count === 1) {
                return true;
            } else {
                console.log(`[SelectorGenerator] Discarding ${selector} (XPath: ${isXPath}) - Match Count: ${count}`);
                return false;
            }
        } catch (e) {
            console.log(`[SelectorGenerator] Discarding ${selector} (XPath: ${isXPath}) - Error: ${e}`);
            return false;
        }
    }
}

const paginationSelectors = new PaginationSelectors();

/** Selector candidates for a picked Next / Load more button. */
export function nextButtonSelectors(element: HTMLElement): SelectorResult[] {
    return paginationSelectors.generate(element);
}

export interface ValidationOptions {
    requireVisible?: boolean;
    requireEnabled?: boolean;
    requireInViewport?: boolean;
    expectedByteSize?: number | null;
}

export interface NextButtonMatch {
    success: boolean;
    index?: number;
    selector?: string;
    selectorType?: string;
    confidence?: string;
    elementInfo?: any;
    element?: HTMLElement;
    error?: string;
    failureReasons?: string[];
}

/**
 * Ported logic from background-readable.js (findClickableElement)
 * Encapsulates the logic for finding and validating the "Next" button using a list of selectors.
 */
export class NextButtonSelector {

    /**
     * Finds the best clickable element that matches one of the provided selectors.
     * Corresponds to `findClickableElement` in background-readable.js
     */
    public static find(
        root: Document | HTMLElement,
        selectors: Array<{ value: string, type: 'selector' | 'xpath' }>,
        elementName: string = 'clickable element',
        options: ValidationOptions = {}
    ): NextButtonMatch {
        const config = {
            requireVisible: true,
            requireEnabled: true,
            requireInViewport: false,
            expectedByteSize: null,
            ...options
        };

        const failureReasons: string[] = [];

        // Helper to check element size (byte size)
        const getByteSize = (el: HTMLElement) => {
            let size = 0;
            try {
                const s = new XMLSerializer().serializeToString(el);
                size = new Blob([s]).size;
            } catch (e) { }
            return size;
        };

        // Helper to select element
        const selectElement = (sel: string, type: string): HTMLElement | null => {
            if (type === 'selector' || type === 'css') {
                const els = root.querySelectorAll(sel);
                return els.length >= 1 ? els[0] as HTMLElement : null;
            }
            if (type === 'xpath') {
                // Fix: use root as context, and allow multiple (pick first)
                const res = document.evaluate(sel, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return res.singleNodeValue as HTMLElement;
            }
            return null;
        };

        // Helper to count matches (for validation)
        const countMatches = (sel: string, type: string): number => {
            if (type === 'selector' || type === 'css') {
                return root.querySelectorAll(sel).length;
            }
            if (type === 'xpath') {
                try {
                    return document.evaluate(sel, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength;
                } catch (e) { return 0; }
            }
            return 0;
        };

        // Helper validation function
        const validateElement = (el: HTMLElement, opts: ValidationOptions): { valid: boolean; reason?: string; confidence?: string; elementInfo?: any } => {
            if (!el) return { valid: false, reason: 'Element not found' };

            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);

            if (opts.requireVisible) {
                if (rect.width === 0 || rect.height === 0) return { valid: false, reason: 'Element has zero dimensions' };
                if (style.display === 'none' || style.visibility === 'hidden') return { valid: false, reason: 'Element is hidden' };
                if (style.opacity === '0') return { valid: false, reason: 'Element is transparent' };
            }

            if (opts.requireEnabled) {
                const disabledAttr = el.getAttribute('disabled');
                const isDisabledAttr = disabledAttr !== null && disabledAttr.toString().toLowerCase() !== 'false' && disabledAttr !== '0';

                // Broad disabled class list: generic + Amazon (a-disabled only, NOT a-last which is used on every page) + others
                const DISABLED_CLASSES = ['disabled', 'is-disabled', 'inactive', 'a-disabled', 'unavailable', 'not-active'];
                const hasDisabledClass = DISABLED_CLASSES.some(cls => el.classList.contains(cls));
                const isAriaDisabled = el.getAttribute('aria-disabled') === 'true';
                const hasNotAllowedCursor = style.cursor === 'not-allowed';
                const hasPointerEventsNone = style.pointerEvents === 'none';

                // Also check parent element (e.g. <span class="a-disabled"><a>Next</a></span>)
                const parent = el.parentElement;
                const parentDisabled = parent ? (
                    DISABLED_CLASSES.some(cls => parent.classList.contains(cls)) ||
                    parent.getAttribute('aria-disabled') === 'true'
                ) : false;

                if ((el as any).disabled || isDisabledAttr || hasDisabledClass || isAriaDisabled ||
                    hasNotAllowedCursor || hasPointerEventsNone || parentDisabled) {
                    return { valid: false, reason: 'Element is disabled (attr/prop/class/style/parent)' };
                }
            }

            if (opts.expectedByteSize) {
                const size = getByteSize(el);
                if (size !== opts.expectedByteSize) {
                    return { valid: false, reason: `Element bytesize mismatch: expected ${opts.expectedByteSize} bytes, got ${size} bytes` };
                }
            }

            const tagNameLower = el.tagName.toLowerCase();
            const isLikeButton = tagNameLower === 'button' || tagNameLower === 'a' || el.getAttribute('role') === 'button';
            const hasClickEvt = el.onclick !== null || el.getAttribute('onclick') || el.classList.contains('btn') || el.classList.contains('button');

            // [NEW] Text-based confidence
            const text = el.textContent?.trim().toLowerCase() || '';
            const hasNextText = text.includes('next') || text.includes('>') || text.includes('»');

            let confidence: 'low' | 'medium' | 'high' = 'low';
            if (isLikeButton && hasNextText) confidence = 'high';
            else if (isLikeButton || (hasClickEvt && hasNextText)) confidence = 'medium';

            return {
                valid: true,
                confidence,
                elementInfo: {
                    tagName: el.tagName,
                    id: el.id,
                    className: el.className,
                    text: text.substring(0, 50),
                    position: {
                        x: Math.round(rect.left),
                        y: Math.round(rect.top),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    },
                    attributes: {
                        disabled: (el as any).disabled,
                        onclick: !!el.onclick,
                        role: el.getAttribute('role'),
                        ariaLabel: el.getAttribute('aria-label'),
                        confidenceScore: this.calculateConfidenceScore(el)
                    },
                    byteSize: opts.expectedByteSize ? getByteSize(el) : undefined
                }
            };
        };

        // Main Loop
        for (let i = 0; i < selectors.length; i++) {
            const { value: sel, type } = selectors[i];
            if (!sel || !type) {
                failureReasons.push(`Selector ${i}: Invalid selector config (missing type or value)`);
                continue;
            }

            try {
                const matchCount = countMatches(sel, type);
                if (matchCount === 0) {
                    // failureReasons.push(`Selector ${i} (${type}): No elements found`);
                    // console.log(`[NextButtonSelector] Failed ${sel}: No matches`);
                    continue;
                }
                // [NEW] Confidence-based selection for multiple matches
                let bestEl: HTMLElement | null = null;
                if (matchCount > 1) {
                    const els = root instanceof Document ?
                        (type === 'xpath' ? this.getAllElementsByXPath(sel, root) : Array.from(root.querySelectorAll(sel))) :
                        (type === 'xpath' ? this.getAllElementsByXPath(sel, root) : Array.from(root.querySelectorAll(sel)));

                    const validEls = (els as HTMLElement[])
                        .map(e => ({ el: e, validation: validateElement(e, config), score: this.calculateConfidenceScore(e) }))
                        .filter(res => res.validation.valid)
                        .sort((a, b) => b.score - a.score);

                    if (validEls.length > 0) {
                        bestEl = validEls[0].el;
                        console.log(`[NextButtonSelector] Multiple valid matches for ${sel}. Picked one with score ${validEls[0].score}`);
                    }
                } else {
                    bestEl = selectElement(sel, type);
                }

                if (!bestEl) {
                    continue;
                }

                const finalValidation = validateElement(bestEl, config);
                if (finalValidation.valid) {
                    console.log(`[NextButtonSelector] Success ${sel}`);
                    return {
                        success: true,
                        index: i,
                        selector: sel,
                        selectorType: type,
                        confidence: finalValidation.confidence,
                        elementInfo: finalValidation.elementInfo,
                        element: bestEl
                    };
                } else {
                    console.log(`[NextButtonSelector] Failed ${sel}: Validation error - ${finalValidation.reason}`);
                    failureReasons.push(`Selector ${i} (${type}): Failed validation - ${finalValidation.reason}`);
                }

            } catch (err: any) {
                console.log(`[NextButtonSelector] Failed ${sel}: Error ${err.message}`);
                failureReasons.push(`Selector ${i} (${type}): Error - ${err.message}`);
            }
        }

        return {
            success: false,
            error: `No valid ${elementName} found after testing ${selectors.length} selectors`,
            failureReasons
        };
    }

    private static calculateConfidenceScore(el: HTMLElement): number {
        let score = 0;
        const tagName = el.tagName.toLowerCase();

        // Base semantics
        if (tagName === 'button') score += 5;
        if (tagName === 'a') score += 4;
        if (el.getAttribute('role') === 'button') score += 5;

        // Classes & Attributes
        if (el.classList.contains('btn') || el.classList.contains('button')) score += 3;
        if (el.onclick !== null || el.getAttribute('onclick')) score += 3;
        if (el.className.toLowerCase().includes('next')) score += 2;
        if (el.getAttribute('aria-label')?.toLowerCase().includes('next')) score += 2;

        // Text content
        const text = el.textContent?.trim().toLowerCase() || '';
        if (text === 'next' || text === 'next >' || text === '>') score += 4;
        else if (text.includes('next')) score += 2;

        return score;
    }

    private static getAllElementsByXPath(xpath: string, root: Document | HTMLElement): HTMLElement[] {
        const results: HTMLElement[] = [];
        const snapshot = document.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < snapshot.snapshotLength; i++) {
            results.push(snapshot.snapshotItem(i) as HTMLElement);
        }
        return results;
    }
}
