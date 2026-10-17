/**
 * The selector chains a pick stores, one function per kind of spec. The picker strategies report
 * these, and the selector corpus (`src/test/corpus`) measures exactly these, so a change to how
 * selectors are chosen is a change here.
 */
import { generateCssSelector, generateRobustSelectors, generateXPath } from './generate';
import { CommonSelectorGenerator } from './common';
import { nextButtonSelectors } from './nextButton';
import { looksLikeXPath } from '../../../shared/selectors/resolve';

export interface ListLocators {
    /** The container's chain, best first (`containerSelectors`). */
    container: { selector: string; strategy: string }[];
    /** The items' chain relative to the container, best first (`itemSelectors`). */
    items: { selector: string; strategy: string }[];
}

/** Container and item chains for a picked list. `target` is the item the user pointed at. */
export function listLocators(container: HTMLElement, items: HTMLElement[], target?: HTMLElement): ListLocators {
    const derived = new CommonSelectorGenerator().deriveCommonSelector(items, container, target);
    return {
        container: generateRobustSelectors(container),
        items: derived.length > 0
            ? derived.map(d => ({ selector: d.selector, strategy: `Deductive ${d.type}` }))
            : [{ selector: generateCssSelector(target ?? items[0], true), strategy: 'Deductive Fallback' }],
    };
}

/** The `[css, xpath]` pair a Page Extractor element stores. */
export function elementLocators(el: HTMLElement): { css: string; xpath: string } {
    const results = generateRobustSelectors(el);
    return {
        css: results.find(r => !looksLikeXPath(r.selector))?.selector ?? generateCssSelector(el),
        xpath: results.find(r => looksLikeXPath(r.selector))?.selector ?? generateXPath(el),
    };
}

/** The chain a picked Next / Load more control stores. */
export function controlLocators(el: HTMLElement): { selector: string; strategy: string }[] {
    return nextButtonSelectors(el);
}
