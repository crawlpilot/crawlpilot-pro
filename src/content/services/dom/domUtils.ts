import { SelectorGenerator, SelectorResult, SelectorOptions } from './selectors/SelectorGenerator';
import { generateCssSelector, generateXPath } from './domBase';

const generator = new SelectorGenerator();

export { generateCssSelector, generateXPath };
export type { SelectorResult, SelectorOptions };

export function generateRobustSelectors(element: HTMLElement, options?: SelectorOptions): SelectorResult[] {
    return generator.generateAll(element, options);
}

/**
 * Escapes parentheses that appear inside CSS class names (e.g. Tailwind v4 CSS-variable
 * utilities like `.h-(--slider-height)` or `.pt-(--border-width)`).
 *
 * `querySelector` throws a DOMException/SyntaxError when a selector contains bare `(`/`)`
 * inside a class token because it tries to parse them as CSS function-call syntax.
 *
 * Strategy: walk the selector character by character; when inside a `.class-name` token
 * (entered after `.`, exited at whitespace / combinators / `[` / `:` / another `.`),
 * escape any `(` → `\(` and `)` → `\)`. All other selector syntax is left unchanged so
 * pseudo-classes like `:nth-of-type(1)` are never touched.
 */
export function sanitizeCssSelector(selector: string): string {
    let result = '';
    let i = 0;
    while (i < selector.length) {
        if (selector[i] === '.') {
            result += '.';
            i++;
            // If the class token starts with a digit, escape it (e.g. .25 → .\32 5 is one way,
            // but simpler: escape with unicode point so querySelector accepts it).
            if (i < selector.length && selector[i] >= '0' && selector[i] <= '9') {
                result += `\\3${selector[i]} `;
                i++;
            }
            // Consume the rest of the class name token.
            // Escape ( ) and dots-before-digits (Tailwind decimal classes like space-y-1.25).
            // Break on structural separators or dots that start a new class name.
            let depth = 0;
            while (i < selector.length) {
                const c = selector[i];
                if (depth === 0) {
                    if (c === '(') {
                        result += '\\(';
                        depth++;
                        i++;
                    } else if (c === ')') {
                        result += '\\)';
                        if (depth > 0) depth--;
                        i++;
                    } else if (c === '.') {
                        const next = i + 1 < selector.length ? selector[i + 1] : '';
                        if (next >= '0' && next <= '9') {
                            // Decimal dot inside class name (e.g. space-y-1.25) — escape it
                            result += '\\.';
                            i++;
                        } else {
                            // New class selector (.foo.bar) — let outer loop handle it
                            break;
                        }
                    } else if (c === ' ' || c === '>' || c === '+' || c === '~' ||
                               c === '[' || c === ':' || c === ',') {
                        break;
                    } else {
                        result += c;
                        i++;
                    }
                } else {
                    if (c === '(') {
                        result += '\\(';
                        depth++;
                        i++;
                    } else if (c === ')') {
                        result += '\\)';
                        depth--;
                        i++;
                    } else {
                        result += c;
                        i++;
                    }
                }
            }
        } else {
            result += selector[i];
            i++;
        }
    }
    return result;
}

/**
 * Robustly simulates a click by dispatching the full pointer/mouse event sequence.
 *
 * Yields between phases via queueMicrotask instead of setTimeout so that:
 * - React and other frameworks process each phase before the next one fires
 * - Background tabs are NOT affected (microtasks run at full speed; setTimeout
 *   is throttled to ≥1000ms per phase in hidden tabs)
 */
export async function clickElementRobust(element: HTMLElement): Promise<boolean> {
    const tick = () => new Promise<void>(r => queueMicrotask(r));

    try {
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

        // 1. Entrance
        element.dispatchEvent(new MouseEvent('mouseover', eventInit));
        element.dispatchEvent(new MouseEvent('mouseenter', eventInit));
        element.dispatchEvent(new PointerEvent('pointerover', eventInit));
        element.dispatchEvent(new PointerEvent('pointerenter', eventInit));

        await tick();

        // 2. Press
        element.dispatchEvent(new PointerEvent('pointerdown', eventInit));
        element.dispatchEvent(new MouseEvent('mousedown', eventInit));
        if (element.focus) element.focus();

        await tick();

        // 3. Release
        element.dispatchEvent(new PointerEvent('pointerup', eventInit));
        element.dispatchEvent(new MouseEvent('mouseup', eventInit));

        await tick();

        // 4. Click
        element.dispatchEvent(new MouseEvent('click', eventInit));

        return true;
    } catch (e) {
        console.error('[domUtils] clickElementRobust failed:', e);
        return false;
    }
}
