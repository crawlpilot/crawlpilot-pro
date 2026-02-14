import { getCssSelector } from 'css-selector-generator';

/**
 * AttributeSelectorGenerator
 * Uses css-selector-generator to create robust, semantic selectors for attributes
 * Solves the fragmentation problem caused by structural HTML variations
 */

export interface AttributeIdentifier {
    selector: string;      // Optimized CSS selector
    displayName: string;   // Human-readable name
    confidence: number;    // 0-1, based on selector specificity
}

export class AttributeSelectorGenerator {
    /**
     * Generate a robust selector for an attribute/field within a container
     * This selector can be used to re-query the same field even if structure changes
     */
    public generateAttributeSelector(
        element: HTMLElement,
        containerRoot: HTMLElement
    ): AttributeIdentifier {

        // Configure css-selector-generator to prefer semantic attributes
        const selector = getCssSelector(element, {
            root: containerRoot,

            // Selector type priority (most stable first)
            selectors: [
                'id',           // #unique-id
                'attribute',    // [data-*] 
                'class',        // .semantic-class
                'tag',          // div, span
                'nthchild'      // :nth-child (fallback)
            ],

            // Prefer data-* attributes
            includeTag: false,  // Avoid generic tags like div, span

            // Whitelist for attributes (prioritize semantic ones)
            whitelist: ['data-*', 'role', 'aria-*', 'itemprop'],

            // Blacklist for classes (avoid utility/generated)
            blacklist: [
                /^[a-z]_[A-Z0-9]+$/,  // w_ABC123 (generated)
                /^sc-[a-z0-9]+/,       // styled-components
                /^css-[a-z0-9]+/,      // CSS modules
                /^(flex|grid|m[tblr]|p[tblr]|text|bg)-/,  // Tailwind
                /^focus/,              // State classes
                /^hover/,
                /^active/
            ],

            // Combine selectors for specificity
            combineWithinSelector: true,
            combineBetweenSelectors: true,

            // Max length to avoid overly specific selectors
            maxCombinations: 50
        });

        // Generate human-readable display name
        const displayName = this.generateDisplayName(element, selector);

        // Calculate confidence based on selector type
        const confidence = this.calculateConfidence(selector);

        return {
            selector,
            displayName,
            confidence
        };
    }

    /**
     * Generate a human-readable name from the selector
     */
    private generateDisplayName(element: HTMLElement, selector: string): string {
        // Try to extract semantic meaning from selector

        // 1. data-* attribute
        const dataMatch = selector.match(/\[data-([^=\]]+)/);
        if (dataMatch) {
            return dataMatch[1]
                .replace(/-/g, ' ')
                .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase to spaces
                .split(' ')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');
        }

        // 2. ID
        const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
        if (idMatch) {
            return idMatch[1]
                .replace(/[-_]/g, ' ')
                .split(' ')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');
        }

        // 3. Semantic class
        const classMatch = selector.match(/\.([a-zA-Z][a-zA-Z0-9_-]+)/);
        if (classMatch) {
            const className = classMatch[1];
            // Skip if it looks generated
            if (!/^[a-z]_[A-Z0-9]+$/.test(className)) {
                return className
                    .replace(/[-_]/g, ' ')
                    .replace(/([a-z])([A-Z])/g, '$1 $2')
                    .split(' ')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ');
            }
        }

        // 4. Fallback: use element content or tag
        const text = element.textContent?.trim();
        if (text && text.length > 0 && text.length < 30) {
            return text.substring(0, 20);
        }

        return element.tagName.charAt(0) + element.tagName.slice(1).toLowerCase();
    }

    /**
     * Calculate confidence based on selector robustness
     */
    private calculateConfidence(selector: string): number {
        let confidence = 0.5;  // Base confidence

        // Boost for data attributes (most stable)
        if (selector.includes('[data-')) {
            confidence += 0.3;
        }

        // Boost for ID
        if (selector.includes('#')) {
            confidence += 0.2;
        }

        // Boost for role/aria
        if (selector.includes('[role') || selector.includes('[aria-')) {
            confidence += 0.2;
        }

        // Penalty for nth-child (fragile)
        if (selector.includes(':nth-child')) {
            confidence -= 0.2;
        }

        // Penalty for overly long selectors (brittle)
        const parts = selector.split(/[\s>+~]/).filter(Boolean);
        if (parts.length > 3) {
            confidence -= 0.1 * (parts.length - 3);
        }

        return Math.max(0.1, Math.min(1.0, confidence));
    }

    /**
     * Generate selectors for all extractable attributes in an element
     */
    public generateAllSelectors(element: HTMLElement, containerRoot: HTMLElement): Map<string, AttributeIdentifier> {
        const selectors = new Map<string, AttributeIdentifier>();
        const processed = new Set<HTMLElement>();

        // DFS traversal to find all leaf elements with extractable data
        const traverse = (el: HTMLElement) => {
            if (processed.has(el)) return;
            processed.add(el);

            // Check if this element has extractable data
            const hasData = this.hasExtractableData(el);

            if (hasData) {
                const identifier = this.generateAttributeSelector(el, containerRoot);
                selectors.set(identifier.selector, identifier);
            }

            // Recurse children
            Array.from(el.children).forEach(child => {
                if (child instanceof HTMLElement) {
                    traverse(child);
                }
            });
        };

        traverse(element);
        return selectors;
    }

    /**
     * Check if an element has extractable data
     */
    private hasExtractableData(element: HTMLElement): boolean {
        // Text content
        const directText = Array.from(element.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent?.trim())
            .filter(Boolean)
            .join(' ');

        if (directText && directText.length > 1) return true;

        // Links
        if (element.tagName === 'A' && element.getAttribute('href')) return true;

        // Images
        if (element.tagName === 'IMG' && element.getAttribute('src')) return true;

        return false;
    }
}
