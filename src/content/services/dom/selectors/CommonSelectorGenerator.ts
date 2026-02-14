import { generateRobustSelectors } from '../domUtils';

export interface DerivedSelector {
    selector: string;
    type: 'CSS' | 'XPath';
}

export class CommonSelectorGenerator {

    /**
     * Derives a list of optimal CSS and XPath selectors that target all the provided elements.
     * Uses generateRobustSelectors internally and filters them based on the exact visual count.
     */
    public deriveCommonSelector(elements: HTMLElement[], root: HTMLElement): DerivedSelector[] {
        if (!elements || elements.length === 0) return [];

        const targetCount = elements.length;
        const validResults: DerivedSelector[] = [];

        // 1. Leverage the robust SelectorGenerator
        const candidates = generateRobustSelectors(elements[0], {
            isList: true,
            root: root
        });

        for (const cand of candidates) {
            if (this.validateSelectorMajority(cand.selector, root, targetCount)) {
                validResults.push({
                    selector: cand.selector,
                    type: this.isXPath(cand.selector) ? 'XPath' : 'CSS'
                });
            }
        }

        // 2. Add manual common semantic fallbacks
        const commonClasses = this.findAllCommonClasses(elements);
        for (const cls of commonClasses) {
            if (this.validateSelectorMajority(cls, root, targetCount)) {
                validResults.push({ selector: cls, type: 'CSS' });
            }

            const className = cls.substring(1);
            const xpathSelector = `//${elements[0].tagName.toLowerCase()}[contains(concat(' ', normalize-space(@class), ' '), ' ${className} ')]`;
            if (this.validateSelectorMajority(xpathSelector, root, targetCount)) {
                validResults.push({ selector: xpathSelector, type: 'XPath' });
            }
        }

        const commonAttrs = this.findAllCommonAttributes(elements);
        for (const attr of commonAttrs) {
            if (this.validateSelectorMajority(attr, root, targetCount)) {
                validResults.push({ selector: attr, type: 'CSS' });
            }

            let xpathAttr = '';
            const tag = elements[0].tagName.toLowerCase();
            if (attr.includes('=')) {
                const parts = attr.match(/\[(.*)="(.*)"\]/);
                if (parts) xpathAttr = `//${tag}[@${parts[1]}="${parts[2]}"]`;
            } else {
                const parts = attr.match(/\[(.*)\]/);
                if (parts) xpathAttr = `//${tag}[@${parts[1]}]`;
            }
            if (xpathAttr && this.validateSelectorMajority(xpathAttr, root, targetCount)) {
                validResults.push({ selector: xpathAttr, type: 'XPath' });
            }
        }

        const commonTag = this.findCommonTag(elements);
        if (commonTag) {
            if (this.validateSelectorMajority(commonTag, root, targetCount)) {
                validResults.push({ selector: commonTag, type: 'CSS' });
            }
            const xpathTag = `//${commonTag}`;
            if (this.validateSelectorMajority(xpathTag, root, targetCount)) {
                validResults.push({ selector: xpathTag, type: 'XPath' });
            }
        }

        // 3. FR-6: Child-Based Targeting ("CSS :has")
        // If the candidate items have common distinct children (e.g. .price), use :has()
        const childFeatures = this.findCommonChildFeatures(elements);
        for (const feature of childFeatures) {
            // Combine with Tag or Class if possible, else generic
            // Preferred: Tag:has(Feature) e.g. div:has(.price)
            const baseTag = elements[0].tagName.toLowerCase();
            const hasSelector = `${baseTag}:has(${feature})`;

            if (this.validateSelectorMajority(hasSelector, root, targetCount)) {
                validResults.push({ selector: hasSelector, type: 'CSS' });
            }

            // Try with common class if available
            if (commonClasses.length > 0) {
                const baseClass = commonClasses[0]; // Best class
                const classHasSelector = `${baseClass}:has(${feature})`;
                if (this.validateSelectorMajority(classHasSelector, root, targetCount)) {
                    validResults.push({ selector: classHasSelector, type: 'CSS' });
                }
            }
        }

        // Deduplicate
        const seen = new Set<string>();
        return validResults.filter(item => {
            if (seen.has(item.selector)) return false;
            seen.add(item.selector);
            return true;
        });
    }

    private isXPath(selector: string): boolean {
        return selector.startsWith('/') || selector.startsWith('(') || selector.startsWith('.//');
    }

    private findCommonChildFeatures(elements: HTMLElement[]): string[] {
        if (elements.length < 2) return [];

        // Scan direct children (and maybe grandchildren) for "Significant" classes
        // Limit depth to 2 for performance

        const candidateFeatures = new Map<string, number>();

        elements.forEach(el => {
            // Get all descendants with significant classes
            const descendants = el.querySelectorAll('*');
            const seenInThisItem = new Set<string>();

            descendants.forEach(d => {
                if (d.className && typeof d.className === 'string') {
                    const classes = this.cleanClasses(d.className.split(/\s+/));
                    for (const cls of classes) {
                        const selector = `.${cls}`;
                        if (!seenInThisItem.has(selector)) {
                            candidateFeatures.set(selector, (candidateFeatures.get(selector) || 0) + 1);
                            seenInThisItem.add(selector);
                        }
                    }
                }
            });
        });

        const threshold = elements.length * 0.8;
        const result: string[] = [];

        candidateFeatures.forEach((count, feature) => {
            if (count >= threshold) {
                result.push(feature);
            }
        });

        // Limit to top 3 features to avoid explosion
        return result.slice(0, 3);
    }

    /**
     * MAJORITY RULE VALIDATION:
     * Accepts a selector if it covers at least 80% of the target elements.
     * This handles feeds where occasional ads or distinct items break strict 100% patterns.
     */
    private validateSelectorMajority(selector: string, root: HTMLElement, targetCount: number): boolean {
        try {
            let matches = 0;
            if (this.isXPath(selector)) {
                const result = document.evaluate(
                    selector,
                    root,
                    null,
                    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                    null
                );
                matches = result.snapshotLength;
            } else {
                matches = root.querySelectorAll(selector).length;
            }

            // Allow for 20% drop (missing items) or up to 2x growth (extra items like hidden ones or ads)
            // But strict lower bound is critical to ensure we actually got the list.
            return matches >= (targetCount * 0.8) && matches <= (targetCount * 2.0);
        } catch { return false; }
    }

    private findAllCommonClasses(elements: HTMLElement[]): string[] {
        if (elements.length === 0) return [];
        // Use the first element that has classes as the baseline
        // (Sometimes first element might be clean but second isn't, so finding first populated one is better)
        const baseline = elements.find(e => e.className && e.className.length > 0) || elements[0];
        if (!baseline) return [];

        let intersection = this.cleanClasses(baseline.className.split(/\s+/));

        // Majority rule for classes too: Class must be present in 80% of items
        const threshold = elements.length * 0.8;

        intersection = intersection.filter(cls => {
            const count = elements.filter(el => {
                const elClasses = el.className.split(/\s+/);
                return elClasses.includes(cls);
            }).length;
            return count >= threshold;
        });

        return intersection.map(c => `.${c}`);
    }

    private findAllCommonAttributes(elements: HTMLElement[]): string[] {
        // Expanded list for modern SPAs (LinkedIn, Instagram, Twitter)
        const priorityAttributes = [
            'data-testid', 'data-test-id', 'data-component', 'itemprop', 'role', 'data-cy', 'aria-label', 'name',
            'data-urn', 'data-id', 'data-entity-urn', 'data-control-name', 'data-li-id', 'data-index'
        ];
        const found: string[] = [];
        const threshold = elements.length * 0.8;

        for (const attr of priorityAttributes) {
            // Count how many have this attribute
            const haveAttr = elements.filter(el => el.hasAttribute(attr));

            if (haveAttr.length >= threshold) {
                // Check value consistency
                // Strategy: If specific value is dominant, use it. If not, generic attribute selector.
                const values = haveAttr.map(el => el.getAttribute(attr));

                // Find most common value
                const valueCounts = new Map<string, number>();
                values.forEach(v => {
                    if (v) valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
                });

                let bestValue = '';
                let bestCount = 0;
                valueCounts.forEach((count, val) => {
                    if (count > bestCount) {
                        bestCount = count;
                        bestValue = val;
                    }
                });

                // If a specific value covers 80% of the *original* set, use it
                if (bestCount >= threshold && bestValue) {
                    const safeValue = bestValue.replace(/"/g, '\\"');
                    found.push(`[${attr}="${safeValue}"]`);
                } else {
                    // Otherwise just use existence
                    found.push(`[${attr}]`);
                }
            }
        }
        return found;
    }

    private findCommonTag(elements: HTMLElement[]): string | null {
        if (elements.length === 0) return null;

        const counts = new Map<string, number>();
        elements.forEach(el => {
            const tag = el.tagName.toLowerCase();
            counts.set(tag, (counts.get(tag) || 0) + 1);
        });

        // Find dominant tag
        let bestTag = '';
        let max = 0;
        counts.forEach((v, k) => {
            if (v > max) {
                max = v;
                bestTag = k;
            }
        });

        if (max >= elements.length * 0.8) {
            return bestTag;
        }
        return null;
    }

    private cleanClasses(classes: string[]): string[] {
        const blacklist = [
            'active', 'hover', 'selected', 'focus', 'current',
            // 'ng-', 'react-', 'ember-', 'vue-'  <-- Relaxed: frameworks often use stable classes like ember-view
            's-matching-dir', 'rush-component',
            'flex', 'grid', 'row', 'col',
            'a-section', 'a-spacing-none',
            'visible', 'hidden'
        ];

        return classes.filter(c =>
            c &&
            c.length > 2 &&
            !/\d/.test(c) && // Still reject purely numeric
            !c.includes(':') &&
            !blacklist.some(b => c.includes(b))
        );
    }
}
