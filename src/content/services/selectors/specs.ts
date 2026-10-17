/**
 * The selector chains a pick stores, one function per kind of spec. The picker strategies report
 * these, and the selector corpus (`src/test/corpus`) measures exactly these, so a change to how
 * selectors are chosen is a change here.
 */
import { elementChain } from './element';
import { nextButtonSelectors } from './nextButton';
import { looksLikeXPath } from '../../../shared/selectors/resolve';

export { listLocators } from './list';
export type { ListLocators } from './list';

/** The `[css, xpath]` pair a Page Extractor element stores. */
export function elementLocators(el: HTMLElement): { css: string; xpath: string } {
    const chain = elementChain(el);
    return {
        css: chain.find(r => !looksLikeXPath(r.selector))?.selector ?? '',
        xpath: chain.find(r => looksLikeXPath(r.selector))?.selector ?? '',
    };
}

/** The chain a picked Next / Load more control stores. */
export function controlLocators(el: HTMLElement): { selector: string; strategy: string }[] {
    return nextButtonSelectors(el);
}
