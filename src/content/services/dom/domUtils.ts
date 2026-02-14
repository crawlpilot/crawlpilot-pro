import { SelectorGenerator, SelectorResult, SelectorOptions } from './selectors/SelectorGenerator';
import { generateCssSelector, generateXPath } from './domBase';

const generator = new SelectorGenerator();

export { generateCssSelector, generateXPath };
export type { SelectorResult, SelectorOptions };

export function generateRobustSelectors(element: HTMLElement, options?: SelectorOptions): SelectorResult[] {
    return generator.generateAll(element, options);
}
