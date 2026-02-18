import { IContainerDetector, ContainerResult } from './IContainerDetector';

/**
 * GroupParentContainerDetector — new default implementation.
 *
 * Inspired by the reference implementation in sidepanel-readable.js.
 * Uses a two-phase approach that is significantly more robust than fingerprinting:
 *
 * Phase 1 — findGroupParent:
 *   Walks up the DOM counting "valid group children" (LI, DIV, TR, ARTICLE, FIGURE, etc.)
 *   at each ancestor level. Returns the ancestor with the most valid children (≥ minRows).
 *   This catches most real-world lists without any fingerprinting.
 *
 * Phase 2 — isListContainer fallback:
 *   If Phase 1 doesn't find a strong candidate, walks up to 10 levels and checks each
 *   ancestor against a multi-signal heuristic:
 *     - Semantic tags: UL, OL, DL, TABLE, TBODY
 *     - ARIA roles: role="list"
 *     - Class names: "list", "results", "grid", "cards", "products"
 *     - CSS display: grid or flex
 *     - Similar child heights (within 50% of mean)
 *     - Similar child descendant counts (within 50% of mean)
 *     - ≥60% of children share the same tag name
 *
 * Strengths: Works regardless of where inside a card the user hovers.
 *            Handles UL/OL, CSS grids, flex rows, and custom card layouts.
 * Weaknesses: May occasionally pick a slightly larger container than intended
 *             on pages with unusual nesting. Use ↑/↓ keyboard nav to adjust scope.
 */
export class GroupParentContainerDetector implements IContainerDetector {
    private minRows = 3;
    private maxLevelsUp = 10;

    public findContainer(element: HTMLElement): ContainerResult {
        console.log('[GroupParentContainerDetector] findContainer for:', element);

        // --- Phase 1: findGroupParent (fast, tag-based) ---
        const groupResult = this.findGroupParent(element);
        if (groupResult) {
            console.log('[GroupParentContainerDetector] Phase 1 hit:', groupResult.container, 'children:', groupResult.childCount);
            return {
                isContainer: true,
                container: groupResult.container,
                childCount: groupResult.childCount,
                siblings: groupResult.children,
                confidence: 90,
                candidates: [groupResult]
            };
        }

        // --- Phase 2: isListContainer fallback ---
        const fallbackResult = this.findListContainerFallback(element);
        if (fallbackResult) {
            console.log('[GroupParentContainerDetector] Phase 2 hit:', fallbackResult.container, 'children:', fallbackResult.childCount);
            return fallbackResult;
        }

        console.log('[GroupParentContainerDetector] No container found.');
        return { isContainer: false, container: null, childCount: 0, siblings: [], confidence: 0 };
    }

    // -------------------------------------------------------------------------
    // Phase 1: Group Parent Detection
    // -------------------------------------------------------------------------

    /**
     * Walks up the DOM from `element`, counting valid group children at each level.
     * Returns the ancestor with the highest count of valid group children (≥ minRows).
     */
    private findGroupParent(element: HTMLElement): { container: HTMLElement; children: HTMLElement[]; childCount: number } | null {
        let current: HTMLElement | null = element;
        let bestCandidate: { container: HTMLElement; children: HTMLElement[]; childCount: number } | null = null;
        let bestCount = 0;

        try {
            while (current && current !== document.body && current !== document.documentElement) {
                const validChildren: HTMLElement[] = [];

                for (const child of Array.from(current.children) as HTMLElement[]) {
                    if (this.isValidGroupElement(child) && child.offsetHeight > 0) {
                        validChildren.push(child);
                    }
                }

                if (validChildren.length >= this.minRows && validChildren.length > bestCount) {
                    bestCount = validChildren.length;
                    bestCandidate = {
                        container: current,
                        children: validChildren,
                        childCount: validChildren.length
                    };
                }

                current = current.parentElement;
            }
        } catch (e) {
            console.warn('[GroupParentContainerDetector] findGroupParent error:', e);
        }

        return bestCandidate;
    }

    /**
     * Determines if an element is a valid repeating group item.
     * Matches the reference implementation's isValidGroupElement.
     */
    private isValidGroupElement(el: HTMLElement): boolean {
        const tag = el.tagName;
        // Standard list/grid item tags
        if (['LI', 'TR', 'DIV', 'ARTICLE', 'A', 'FIGURE', 'DETAILS', 'ASIDE', 'SUMMARY'].includes(tag)) {
            return true;
        }
        // Custom elements (tag names with a hyphen, e.g. <product-card>)
        if (/-/.test(tag)) {
            return true;
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // Phase 2: Multi-signal isListContainer Fallback
    // -------------------------------------------------------------------------

    /**
     * Walks up the DOM and checks each ancestor with a multi-signal heuristic.
     * Picks the ancestor with the most children that passes the check.
     */
    private findListContainerFallback(element: HTMLElement): ContainerResult | null {
        let current: HTMLElement | null = element;
        let bestContainer: HTMLElement | null = null;
        let bestChildCount = 0;

        for (let level = 0; level < this.maxLevelsUp; level++) {
            if (!current || current === document.body || current === document.documentElement) break;

            if (this.isListContainer(current)) {
                const childCount = current.children.length;
                if (childCount > bestChildCount) {
                    bestChildCount = childCount;
                    bestContainer = current;
                }
            }

            current = current.parentElement;
        }

        if (!bestContainer) return null;

        const siblings = Array.from(bestContainer.children).filter(
            c => (c as HTMLElement).offsetHeight > 0
        ) as HTMLElement[];

        return {
            isContainer: true,
            container: bestContainer,
            childCount: siblings.length,
            siblings,
            confidence: 70,
            candidates: []
        };
    }

    /**
     * Multi-signal check: is this element a list/grid container?
     * Mirrors the reference implementation's `p()` function.
     */
    private isListContainer(el: HTMLElement): boolean {
        if (!el || !el.children) return false;
        if (el.children.length < 2) return false;

        // 1. Semantic list/table tags
        if (['UL', 'OL', 'DL', 'TABLE', 'TBODY'].includes(el.tagName)) return true;

        // 2. ARIA role
        if (el.getAttribute('role') === 'list') return true;
        if (el.getAttribute('aria-role') === 'list') return true;

        // 3. Class name signals
        const className = (el.getAttribute('class') || '').toLowerCase();
        if (className && ['list', 'results', 'grid', 'cards', 'products', 'feed', 'items'].some(k => className.includes(k))) {
            return el.children.length >= 2;
        }

        // 4. CSS display: grid or flex
        try {
            const display = window.getComputedStyle(el).getPropertyValue('display');
            if (display === 'grid' || display === 'flex') return true;
        } catch (_) { /* ignore */ }

        const children = Array.from(el.children) as HTMLElement[];

        // 5. Similar child heights (within 50% of mean) — indicates uniform cards/rows
        if (children.length >= 3) {
            const heights = children.map(c => c.offsetHeight);
            const meanHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
            const similarHeights = meanHeight > 0 && heights.every(h => Math.abs(h - meanHeight) < 0.5 * meanHeight);

            if (similarHeights) {
                // Also check similar descendant counts
                const descCounts = children.map(c => c.querySelectorAll('*').length);
                const meanDesc = descCounts.reduce((a, b) => a + b, 0) / descCounts.length;
                const similarDesc = meanDesc > 0 && descCounts.every(d => Math.abs(d - meanDesc) < 0.5 * meanDesc);
                if (similarDesc) return true;
            }
        }

        // 6. ≥60% of children share the same tag name (dominant tag)
        const tagCounts: Record<string, number> = {};
        children.forEach(c => { tagCounts[c.tagName] = (tagCounts[c.tagName] || 0) + 1; });
        const dominantTag = Object.keys(tagCounts).reduce((a, b) => tagCounts[a] > tagCounts[b] ? a : b, '');
        if (dominantTag && tagCounts[dominantTag] / el.children.length >= 0.6) return true;

        return false;
    }
}
