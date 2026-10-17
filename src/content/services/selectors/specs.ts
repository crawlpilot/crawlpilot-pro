/**
 * The selector chains a pick stores, one function per kind of spec. The picker strategies report
 * these, and the selector corpus (`src/test/corpus`) measures exactly these, so a change to how
 * selectors are chosen is a change here.
 */
import { generateCssSelector, generateRobustSelectors, generateXPath } from './generate';
import { nextButtonSelectors } from './nextButton';
import { looksLikeXPath } from '../../../shared/selectors/resolve';

export { listLocators } from './list';
export type { ListLocators } from './list';

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
