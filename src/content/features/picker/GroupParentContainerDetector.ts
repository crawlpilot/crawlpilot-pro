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
                containerType: this.determineContainerType(groupResult.container, groupResult.children),
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
                    if (this.isValidGroupElement(child) && this.isVisible(child)) {
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
     * More robust visibility check that handles display: contents and SPAs.
     */
    private isVisible(el: HTMLElement): boolean {
        // Physical height is the primary signal
        if (el.offsetHeight > 0) return true;

        // display: contents elements have 0 offsetHeight but are "visible" to users
        try {
            const style = window.getComputedStyle(el);
            if (style.display === 'contents' || el.hasAttribute('data-display-contents')) {
                // If it's display:contents, check if it has any visible children
                return Array.from(el.children).some(child => this.isVisible(child as HTMLElement));
            }
        } catch (e) { /* ignore */ }

        return false;
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

    /**
     * Looks within the element or its descendants for repeating items.
     * Prioritizes elements with visible text content.
     */
    public findInternalContainer(element: HTMLElement): ContainerResult {
        // 1. Check if the element itself is a container of repeating items
        const children = Array.from(element.children) as HTMLElement[];
        const visibleChildrenWithText = children.filter(c =>
            this.isVisible(c as HTMLElement) &&
            this.isValidGroupElement(c as HTMLElement) &&
            (c.innerText || c.textContent || '').trim().length > 0
        ) as HTMLElement[];

        if (visibleChildrenWithText.length >= this.minRows) {
            return {
                isContainer: true,
                containerType: this.determineContainerType(element, visibleChildrenWithText),
                container: element,
                siblings: visibleChildrenWithText,
                childCount: visibleChildrenWithText.length,
                confidence: 95
            };
        }

        // 2. Look for the first dominant list descendant (e.g. UL, TABLE, or [role="list"])
        const deepLists = element.querySelectorAll('ul, ol, table, tbody, [role="list"]');
        for (const list of Array.from(deepLists) as HTMLElement[]) {
            const listChildren = Array.from(list.children) as HTMLElement[];
            const valid = listChildren.filter(c =>
                this.isVisible(c as HTMLElement) && // Use the new isVisible method
                (c.innerText || c.textContent || '').trim().length > 0
            ) as HTMLElement[];
            if (valid.length >= 2) {
                return {
                    isContainer: true,
                    containerType: this.determineContainerType(list, valid),
                    container: list,
                    siblings: valid,
                    childCount: valid.length,
                    confidence: 90
                };
            }
        }

        // 3. Deep downward scan: find any descendant element with the most valid group children (≥ minRows).
        // This catches div-based repeating containers like <div.nt1> with many <div.pb2> children
        // that are not caught by Steps 1 or 2 because they aren't semantic list/table tags.
        {
            const allDescendants = Array.from(element.querySelectorAll('*')) as HTMLElement[];
            let bestContainer: HTMLElement | null = null;
            let bestChildren: HTMLElement[] = [];
            let bestCount = 0;

            for (const desc of allDescendants) {
                const validChildren = (Array.from(desc.children) as HTMLElement[]).filter(
                    c => this.isValidGroupElement(c) && this.isVisible(c) && (c.innerText || c.textContent || '').trim().length > 0
                );
                if (validChildren.length >= 2 && validChildren.length > bestCount) {
                    bestCount = validChildren.length;
                    bestContainer = desc;
                    bestChildren = validChildren;
                }
            }

            if (bestContainer && bestChildren.length > 0) {
                return {
                    isContainer: true,
                    containerType: this.determineContainerType(bestContainer, bestChildren),
                    container: bestContainer,
                    siblings: bestChildren,
                    childCount: bestChildren.length,
                    confidence: 85
                };
            }
        }

        return { isContainer: false, container: null, childCount: 0, siblings: [], confidence: 0 };
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
            c => this.isVisible(c as HTMLElement)
        ) as HTMLElement[];

        return {
            isContainer: true,
            containerType: this.determineContainerType(bestContainer, siblings),
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

    /**
     * Identifies whether the container acts more like a traditional table/grid or a simple list.
     */
    private determineContainerType(container: HTMLElement, siblings: HTMLElement[]): 'list' | 'table' {
        if (!container) return 'list';

        const tag = container.tagName.toUpperCase();
        // Semantic table AND ordered/unordered list tags → each child is a distinct row
        if (tag === 'TABLE' || tag === 'TBODY' || tag === 'THEAD' || tag === 'UL' || tag === 'OL') {
            return 'table';
        }

        // Check if css display is grid or table
        try {
            const display = window.getComputedStyle(container).display;
            if (display.includes('table') || display === 'grid' || display === 'inline-grid') {
                return 'table';
            }
        } catch (e) { /* ignore */ }

        // Heuristic 1: If the container itself has display: grid and columns, it's highly likely a table/grid representation
        try {
            const computedStyle = window.getComputedStyle(container);
            if (computedStyle.display === 'grid' || computedStyle.display === 'inline-grid') {
                const gridTemplateColumns = computedStyle.gridTemplateColumns;
                if (gridTemplateColumns && gridTemplateColumns !== 'none' && gridTemplateColumns.split(' ').length > 1) {
                    return 'table';
                }
            }
        } catch (e) { /* ignore */ }

        // Heuristic 2: If siblings (rows) consist of multiple distinct cells/columns
        // For example, a specifications table where each row is a div containing a label and a value,
        // or a data grid implemented with flexbox rows.
        if (siblings.length >= 2) {
            let multiCellRowCount = 0;
            const childCounts: number[] = [];

            for (const sibling of siblings) {
                const childCount = sibling.children.length;
                childCounts.push(childCount);
                // A row with 2 to 10 distinct top-level element children usually implies columns
                if (childCount >= 2 && childCount <= 10) {
                    multiCellRowCount++;
                }
            }

            // If almost all rows have multiple children, let's check for structural uniformity
            if (multiCellRowCount / siblings.length >= 0.8) {
                // Determine the mode (most common number of children per row)
                const counts = childCounts;
                const mode = counts.sort((a, b) =>
                    counts.filter(v => v === a).length - counts.filter(v => v === b).length
                ).pop();

                // If it's a tight row structure (e.g., exactly 2 elements per row like Key-Value, or 3-5 columns)
                // and there's a strong consistency across rows, identify it as a table.
                if (mode !== undefined && mode >= 2) {
                    const consistency = counts.filter(c => c === mode).length / counts.length;
                    if (consistency > 0.7) {
                        return 'table';
                    }
                }
            }
        }

        return 'list';
    }
}
