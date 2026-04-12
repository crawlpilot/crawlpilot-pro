import { SelectorGenerator, SelectorResult, SelectorOptions } from './selectors/SelectorGenerator';
import { generateCssSelector, generateXPath } from './domBase';

const generator = new SelectorGenerator();

export { generateCssSelector, generateXPath };
export type { SelectorResult, SelectorOptions };

export function generateRobustSelectors(element: HTMLElement, options?: SelectorOptions): SelectorResult[] {
    return generator.generateAll(element, options);
}

/**
 * Robustly simulates a click by dispatching mousedown, mouseup, and click sequence.
 * This mimics legacy Module 588 logic from reference code.
 */
export async function clickElementRobust(element: HTMLElement): Promise<boolean> {
    try {
        console.log('👆 [domUtils] Starting robust multi-event click sequence on:', element.tagName, element.className);

        const rect = element.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;

        const eventInit = {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            button: 0,
            buttons: 1,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true
        } as any;

        // 1. Entrance events
        element.dispatchEvent(new MouseEvent('mouseover', eventInit));
        element.dispatchEvent(new MouseEvent('mouseenter', eventInit));
        element.dispatchEvent(new PointerEvent('pointerover', eventInit));
        element.dispatchEvent(new PointerEvent('pointerenter', eventInit));

        await new Promise(r => setTimeout(r, 30));

        // 2. Interaction starts
        element.dispatchEvent(new PointerEvent('pointerdown', eventInit));
        element.dispatchEvent(new MouseEvent('mousedown', eventInit));

        // Handle focus
        if (element.focus) element.focus();

        await new Promise(r => setTimeout(r, 50));

        // 3. Interaction release
        element.dispatchEvent(new PointerEvent('pointerup', eventInit));
        element.dispatchEvent(new MouseEvent('mouseup', eventInit));

        await new Promise(r => setTimeout(r, 30));

        // 4. Final Click event
        const clickEvent = new MouseEvent('click', eventInit);
        element.dispatchEvent(clickEvent);

        // 5. Native Fallback
        // Removed unconditional native fallback to prevent double-clicks
        // if (element.click && typeof element.click === 'function') {
        //     element.click();
        // }

        console.log('✅ [domUtils] Sequence complete.');
        return true;
    } catch (e) {
        console.error('❌ [domUtils] Robust click sequence failed:', e);
        return false;
    }
}
