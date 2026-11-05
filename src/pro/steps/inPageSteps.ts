/**
 * The in-page half of Pro's step runner (`docs/plans/pro-data-collection-plan.md`, C1): finds a step's
 * target with the extension's own selector resolution, counting only elements a visitor can see (a dialog's
 * input is in the page before the dialog opens), and marks it so the caller can act on it. The worker acts
 * with Playwright (real input events); Pro will act from its content script.
 * Plain DOM code: bundled into the worker's in-page script (`src/pro/crawler/inPage.ts`).
 */
import { resolveItems } from '../../shared/selectors/resolve';

/** The attribute a found target carries until the next search. */
export const MARK = 'data-crawlpilot-step';

export interface TargetRequest {
    /** The step's selectors, best first. */
    selectors: string[];
    /** Choose among the matches: the one whose text contains `text`, or the `index`-th. */
    choose?: { text?: string; index?: number };
    /** The mark to put on the target. */
    mark: string;
}

export interface TargetResult {
    found: boolean;
    /** Which selector found it, or -1. */
    used: number;
    /** Per selector: does it match a visible element? For selector usage. */
    matches: boolean[];
    /** The target's visible text, cut short. */
    text?: string;
}

const visible = (el: Element): boolean => {
    if (el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
};

const textOf = (el: Element): string => ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Finds the step's target among visible elements and marks it. */
export function markTarget({ selectors, choose, mark }: TargetRequest): TargetResult {
    for (const el of Array.from(document.querySelectorAll(`[${MARK}]`))) el.removeAttribute(MARK);
    const shown = selectors.map(sel => resolveItems([sel], document).result.filter(visible));
    const matches = shown.map(list => list.length > 0);
    for (let i = 0; i < shown.length; i++) {
        const list = shown[i];
        if (!list.length) continue;
        let target: Element | undefined = list[0];
        if (choose?.text !== undefined) {
            const want = norm(choose.text);
            // The tightest match: an item whose own text contains it, the shortest first (not the whole list).
            target = list.filter(el => norm(textOf(el)).includes(want)).sort((a, b) => textOf(a).length - textOf(b).length)[0];
        } else if (choose?.index !== undefined) {
            target = list[choose.index];
        }
        if (!target) continue;
        target.setAttribute(MARK, mark);
        return { found: true, used: i, matches, text: textOf(target).slice(0, 300) };
    }
    return { found: false, used: -1, matches };
}

/** The visible items the first matching selector finds, by their text: what a "for each" step goes through. */
export function listItems(selectors: string[]): string[] {
    for (const sel of selectors) {
        const items = resolveItems([sel], document).result.filter(visible);
        if (items.length) return items.map(textOf);
    }
    return [];
}

/** Whether any selector matches a visible element: for waiting on something to appear or go. */
export function isShown(selectors: string[]): boolean {
    return selectors.some(sel => resolveItems([sel], document).result.some(visible));
}
