/**
 * The picker's selection path (docs/plans/picker-level-control-plan.md §3.1): the hovered element and
 * the ancestors that look different on screen. Wider / Narrower move along it, so every step changes
 * the outline, and Narrower walks back toward where the cursor started. Siblings move at one level.
 */
import { getVisualRect } from '../../utils/rendering';

export type RectOf = (el: HTMLElement) => { top: number; left: number; width: number; height: number };

const SAME_PX = 2;

function sameBox(a: ReturnType<RectOf>, b: ReturnType<RectOf>): boolean {
    return Math.abs(a.top - b.top) <= SAME_PX && Math.abs(a.left - b.left) <= SAME_PX
        && Math.abs(a.width - b.width) <= SAME_PX && Math.abs(a.height - b.height) <= SAME_PX;
}

const hasArea = (r: ReturnType<RectOf>) => r.width > 0 && r.height > 0;
const STOP = new Set(['BODY', 'HTML']);

/** Something to read: text, an image, a link, a control, a table cell… (not an empty spacer). */
function hasContent(el: Element): boolean {
    return (el.textContent ?? '').trim().length > 0 || !!el.querySelector('img, svg, picture, video, canvas, iframe, input, select, textarea')
        || /^(IMG|SVG|PICTURE|VIDEO|CANVAS|IFRAME|INPUT|SELECT|TEXTAREA)$/i.test(el.tagName);
}

/**
 * The visible steps from `el` up to (not including) `body`: an ancestor with the same box as the step
 * below it, or with no box, is not a step. `steps[0]` is the element itself (or its first ancestor
 * with a box).
 */
export function visibleSteps(el: HTMLElement, rectOf: RectOf = getVisualRect, twins?: Map<HTMLElement, HTMLElement[]>): HTMLElement[] {
    const steps: HTMLElement[] = [];
    let last: ReturnType<RectOf> | null = null;
    for (let node: HTMLElement | null = el; node && !STOP.has(node.tagName); node = node.parentElement) {
        const r = rectOf(node);
        if (!hasArea(r)) continue;
        if (last && sameBox(r, last)) {
            // The wrapper and its child look the same: the outer one stands for both (what a click on
            // the outline means is the bigger element, and a list's container is usually the outer).
            const inner = steps[steps.length - 1];
            twins?.set(node, [inner, ...(twins.get(inner) ?? [])]);
            steps[steps.length - 1] = node;
            continue;
        }
        steps.push(node);
        last = r;
    }
    // The innermost step is the element the user pointed at when it has a box of its own.
    if (steps.length && steps[0] !== el && hasArea(rectOf(el)) && steps[0].contains(el) && sameBox(rectOf(steps[0]), rectOf(el))) steps[0] = el;
    return steps;
}

/** A child of `el` that looks different from it and has content, preferring the one holding `toward`. */
export function narrowerChild(el: HTMLElement, toward: Element | null = null, rectOf: RectOf = getVisualRect): HTMLElement | null {
    const box = rectOf(el);
    // Down through wrappers with the same box to the first level that differs.
    let level: HTMLElement[] = Array.from(el.children) as HTMLElement[];
    for (let depth = 0; depth < 12 && level.length; depth++) {
        const shown = level.filter(c => hasArea(rectOf(c)) && hasContent(c));
        const pick = shown.find(c => toward && c.contains(toward)) ?? shown[0];
        if (!pick) {
            level = level.flatMap(c => Array.from(c.children) as HTMLElement[]);
            continue;
        }
        if (!sameBox(rectOf(pick), box)) return pick;
        level = Array.from(pick.children) as HTMLElement[];
    }
    return null;
}

/** The previous / next sibling at this level that shows content (the next spec row, the next card). */
export function siblingOf(el: HTMLElement, dir: 1 | -1, rectOf: RectOf = getVisualRect): HTMLElement | null {
    let node = (dir > 0 ? el.nextElementSibling : el.previousElementSibling) as HTMLElement | null;
    while (node) {
        if (hasArea(rectOf(node)) && hasContent(node)) return node;
        node = (dir > 0 ? node.nextElementSibling : node.previousElementSibling) as HTMLElement | null;
    }
    return null;
}

/**
 * Where the selection is on its path. `start` is the element the user pointed at: Narrower walks back
 * toward it, and past it into the child holding it.
 */
export class SelectionPath {
    steps: HTMLElement[];
    index = 0;
    /** The wrappers each step stands for (same box), innermost first: a step can be named by them. */
    readonly twins = new Map<HTMLElement, HTMLElement[]>();

    constructor(public start: HTMLElement, private rectOf: RectOf = getVisualRect) {
        this.steps = visibleSteps(start, rectOf, this.twins);
        if (!this.steps.length) this.steps = [start];
    }

    get current(): HTMLElement { return this.steps[this.index]; }

    /** One visible step up; false at the top. */
    wider(): boolean {
        if (this.index + 1 >= this.steps.length) return false;
        this.index++;
        return true;
    }

    /** One visible step down, toward `start`; below it, into its first child that looks different. */
    narrower(): boolean {
        if (this.index > 0) { this.index--; return true; }
        const child = narrowerChild(this.current, null, this.rectOf);
        if (!child) return false;
        this.steps = [child, ...this.steps];
        this.start = child;
        return true;
    }

    /** The previous / next sibling at this level: the path above stays, the steps below are rebuilt. */
    sibling(dir: 1 | -1): boolean {
        const next = siblingOf(this.current, dir, this.rectOf);
        if (!next) return false;
        const above = this.steps.slice(this.index + 1);
        this.steps = [next, ...above];
        this.index = 0;
        this.start = next;
        return true;
    }

    /** Jumps to a step (a breadcrumb click). */
    at(index: number): boolean {
        if (index < 0 || index >= this.steps.length || index === this.index) return false;
        this.index = index;
        return true;
    }
}
