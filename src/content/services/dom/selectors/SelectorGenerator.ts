import { getCssSelector } from 'css-selector-generator';
import { select } from 'optimal-select';
import { generateCssSelector, generateXPath } from '../domBase';

export interface SelectorResult {
    selector: string;
    strategy: string;
}

export interface SelectorStrategy {
    name: string;
    generate(element: HTMLElement, options?: SelectorOptions): string[];
    priority: number; // Higher is better
}

export interface SelectorOptions {
    root?: HTMLElement;
    isList?: boolean;
}

export class IdSelectorStrategy implements SelectorStrategy {
    name = 'ID';
    priority = 100;
    generate(element: HTMLElement, options?: SelectorOptions): string[] {
        if (options?.isList) return []; // IDs are usually unique, don't use for list items

        const id = element.id;
        if (!id) return [];

        // [CHANGED] Stricter Stability Checks
        // Reject if:
        // 1. Contains digits (often auto-gen)
        // 2. Contains "Instance", "ember", "react", "guid", "uid" (framework gen)
        // 3. Very long (> 40 chars)
        if (/\d/.test(id)) return [];
        if (/(Instance|ember|react|guid|uid|_)/i.test(id)) return [];
        if (id.length > 40) return [];

        if (document.querySelectorAll(`#${id}`).length === 1) {
            return [`#${id}`];
        }
        return [];
    }
}

export class ClassSelectorStrategy implements SelectorStrategy {
    name = 'Class';
    priority = 80;
    generate(element: HTMLElement): string[] {
        const results: string[] = [];
        if (element.className && typeof element.className === 'string') {
            const classes = element.className.split(/\s+/).filter(c =>
                c &&
                !['active', 'hover', 'selected', 'focus', 'current'].includes(c) &&
                !c.match(/^[0-9]/) &&
                !c.includes(':')
            );

            if (classes.length > 0) {
                const tag = element.tagName.toLowerCase();

                // 1. All classes joined (Most specific)
                results.push(`${tag}.${classes.join('.')}`);

                // 2. Individual classes (More general)
                classes.forEach(c => {
                    results.push(`.${c}`);
                    results.push(`${tag}.${c}`);
                });
            }
        }
        return results;
    }
}

export class OptimalSelectStrategy implements SelectorStrategy {
    name = 'Optimal Select';
    priority = 105; // Highest priority
    generate(element: HTMLElement, options?: SelectorOptions): string[] {
        try {
            const selectOptions: any = {
                root: options?.root || document.body
            };

            if (options?.isList) {
                // If it's a list item, we want to stay general
                selectOptions.ignore = {
                    attribute: (name: string) => name === 'id' || name === 'href' || name.includes('hash'),
                    nth: () => true // Ignore all nth-child/nth-of-type
                };
            }

            const selector = select(element, selectOptions);
            return selector ? [selector] : [];
        } catch (e) {
            return [];
        }
    }
}

export class GeneratorLibraryStrategy implements SelectorStrategy {
    name = 'CSS Gen';
    priority = 102; // Very high priority
    generate(element: HTMLElement, options?: SelectorOptions): string[] {
        try {
            const genOptions: any = {
                root: options?.root || document.body,
                selectors: ['class', 'tag', 'attribute']
            };

            if (!options?.isList) {
                genOptions.selectors.unshift('id');
                genOptions.selectors.push('nthchild');
            }

            const selector = getCssSelector(element, genOptions);
            return selector ? [selector] : [];
        } catch (e) {
            return [];
        }
    }
}

export class XPathStrategy implements SelectorStrategy {
    name = 'XPath';
    priority = 50;
    generate(element: HTMLElement): string[] {
        const xpath = generateXPath(element);
        return xpath ? [xpath] : [];
    }
}

export class AttributeStrategy implements SelectorStrategy {
    name = 'Attribute';
    priority = 95;
    generate(element: HTMLElement): string[] {
        const results: string[] = [];
        // [CHANGED] Explicit whitelist of useful semantic attributes, excluding style/width/height/etc
        const attributes = ['data-testid', 'data-cy', 'data-component-type', 'name', 'role', 'aria-label', 'title', 'rel', 'href', 'type'];

        for (const attr of attributes) {
            if (element.hasAttribute(attr)) {
                const val = element.getAttribute(attr);
                if (val && val.length < 100) { // arbitrary limit to avoid massive data-json
                    // Escape quotes
                    const safeVal = val.replace(/"/g, '\\"');
                    results.push(`[${attr}="${safeVal}"]`);
                    // Tag + Attribute often cleaner
                    results.push(`${element.tagName.toLowerCase()}[${attr}="${safeVal}"]`);
                }
            }
        }
        return results;
    }
}

export class PathSelectorStrategy implements SelectorStrategy {
    name = 'Path';
    priority = 70;
    generate(element: HTMLElement): string[] {
        const results: string[] = [];
        const specific = generateCssSelector(element, false);
        const generalized = generateCssSelector(element, true);
        if (specific) results.push(specific);
        if (generalized && generalized !== specific) results.push(generalized);
        return results;
    }
}

export class SelectorGenerator {
    private strategies: SelectorStrategy[] = [
        new AttributeStrategy(),
        new ClassSelectorStrategy(),
        new OptimalSelectStrategy(),
        new GeneratorLibraryStrategy(),
        new PathSelectorStrategy(),
        new IdSelectorStrategy(),
        new XPathStrategy()
    ];

    public generateAll(element: HTMLElement, options?: SelectorOptions): SelectorResult[] {
        const results: SelectorResult[] = [];
        const seen = new Set<string>();

        // Sort strategies by priority
        const sorted = [...this.strategies].sort((a, b) => b.priority - a.priority);

        for (const strategy of sorted) {
            const candidates = strategy.generate(element, options);
            candidates.forEach(selector => {
                if (selector && !seen.has(selector)) {
                    seen.add(selector);
                    results.push({ selector, strategy: strategy.name });
                }
            });
        }

        return results;
    }

    public generateBest(element: HTMLElement, options?: SelectorOptions): string {
        const results = this.generateAll(element, options);
        return results.length > 0 ? results[0].selector : element.tagName.toLowerCase();
    }
}
