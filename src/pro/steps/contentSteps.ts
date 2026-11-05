/**
 * Pro's step runner in the user's tab, and the page's markup read for Pro's tests (`../markup/markup.ts`) (`docs/plans/pro-data-collection-plan.md`, C1): injected by Pro
 * (`src/pro/runner/tabSteps.ts`) only when a recipe has steps to run. It finds targets as the worker does
 * (`inPageSteps.ts`) and acts on them with the events a page's framework listens to: pointer and mouse events
 * and a click; the native value setter plus `input` and `change` for typing (so React and Vue see the value);
 * key events. These are not trusted browser events: a site that ignores them can't be driven from here (the
 * worker, with Playwright, can).
 */
import { isShown, listItems, MARK, markTarget } from './inPageSteps';
import { listMarkup, readMarkupFields } from '../markup/markup';
import { clearFields, focusField, showFields } from './showFields';

export interface ActRequest {
    mark: string;
    do: 'click' | 'type' | 'choose' | 'select' | 'press' | 'scroll';
    value?: string;
    enter?: boolean;
}

const fire = (el: EventTarget, type: string, init: object = {}) => el.dispatchEvent(new (type.startsWith('key') ? KeyboardEvent : type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, composed: true, ...init } as never));

function key(el: EventTarget, k: string) {
    const init = { key: k, code: k === 'Enter' ? 'Enter' : k === 'Escape' ? 'Escape' : k, keyCode: k === 'Enter' ? 13 : k === 'Escape' ? 27 : 0 };
    fire(el, 'keydown', init);
    fire(el, 'keypress', init);
    fire(el, 'keyup', init);
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Acts on the marked target. */
function act(r: ActRequest): { ok: boolean; error?: string } {
    const el = document.querySelector(`[${MARK}="${r.mark}"]`) as HTMLElement | null;
    if (!el) return { ok: false, error: 'its element went away before it could be used' };
    el.scrollIntoView({ block: 'center' });
    switch (r.do) {
        case 'click': case 'choose':
            fire(el, 'pointerdown'); fire(el, 'mousedown'); fire(el, 'pointerup'); fire(el, 'mouseup');
            el.click();
            return { ok: true };
        case 'type': {
            if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return { ok: false, error: 'it is not a text box' };
            el.focus();
            setValue(el, '');
            setValue(el, r.value ?? '');
            if (r.enter) key(el, 'Enter');
            return { ok: true };
        }
        case 'select': {
            if (!(el instanceof HTMLSelectElement)) return { ok: false, error: 'it is not a dropdown' };
            const want = (r.value ?? '').trim().toLowerCase();
            const option = Array.from(el.options).find(o => o.text.trim().toLowerCase() === want) ?? Array.from(el.options).find(o => o.value === r.value);
            if (!option) return { ok: false, error: `it has no option "${r.value}"` };
            setValue(el, option.value);
            return { ok: true };
        }
        case 'press':
            el.focus();
            key(el, r.value || 'Enter');
            return { ok: true };
        case 'scroll':
            return { ok: true };
    }
}

function pressKey(k: string) {
    key(document.activeElement ?? document.body, k);
}

function scrollToEnd() {
    window.scrollTo(0, document.documentElement.scrollHeight);
}

(globalThis as unknown as { crawlpilotSteps: object }).crawlpilotSteps = { markTarget, isShown, listItems, act, pressKey, scrollToEnd, readMarkupFields, listMarkup, showFields, focusField, clearFields };
