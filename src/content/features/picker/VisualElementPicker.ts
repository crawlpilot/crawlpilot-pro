/**
 * The visual picker: overlay, outline, tooltip and the bar at the bottom of the page.
 *
 * The user controls how much is selected (docs/plans/picker-level-control-plan.md):
 * - Wider / Narrower move along the selection path, one visible step at a time, and Narrower walks back
 *   toward where the cursor started;
 * - ← / → move to the previous / next item at the same level;
 * - the chosen level holds while the cursor stays inside it, and Space locks it;
 * - a strategy with readings (the Page Extractor's) shows what a click saves; the user can switch it,
 *   and the click saves the reading shown.
 */
import type { ISelectionStrategy, Reading } from './strategies/ISelectionStrategy';
import { getVisualRect } from '../../utils/rendering';
import { ElementSelected, send } from '../../../shared/messages';
import { SelectionPath } from './path';

const reportSelection = (selected: ElementSelected) => { void send('ELEMENT_SELECTED', selected); };

/** Steps shown above the selection in the bar's path (the rest are "…"). */
const STEPS_ABOVE = 3;
/** The least time between two state messages to the side panel. */
const STATE_MS = 120;
const HASHY = /\d{3,}|^[a-z]{1,3}-?[a-z0-9]{5,}$|^css-|^sc-|__/i;

const readableClass = (el: HTMLElement) =>
    typeof el.className === 'string' ? el.className.split(/\s+/).find(c => c && c.length <= 20 && !HASHY.test(c)) : undefined;

/**
 * A short name for a step: its label, or its tag and first readable class. A step that stands for
 * wrappers with the same box (`twins`) takes the most telling name among them ("price-block", not "wrap").
 */
function stepLabel(el: HTMLElement, twins: HTMLElement[] = []): string {
    for (const node of [el, ...twins]) {
        const aria = node.getAttribute('aria-label')?.trim();
        if (aria && aria.length <= 24) return aria;
    }
    // The innermost readable class names it best ("price-block" inside "wrap"), with its own tag.
    const named = [...twins, el].find(n => readableClass(n));
    return named ? `${named.tagName.toLowerCase()}.${readableClass(named)}` : el.tagName.toLowerCase();
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class VisualElementPicker {
    private overlay: HTMLElement | null = null;
    private tooltip: HTMLElement | null = null;
    private bar: HTMLElement | null = null;
    private highlightBox: HTMLElement | null = null;
    private siblingHighlights: Array<{ target: HTMLElement; box: HTMLElement }> = []; // Dashed boxes + their tracked elements
    private currentElement: HTMLElement | null = null;
    private isActive: boolean = false;
    private strategy: ISelectionStrategy | null = null;
    private onCancelCallback: (() => void) | null = null;
    private lastHighlightedElement: HTMLElement | null = null;
    private lastSiblings: HTMLElement[] = [];
    private rafPending = false;
    /** A pick is being read: the highlight stays put and further clicks wait. */
    private busy = false;

    /** Where the selection is: the hovered element and its visible ancestors. */
    private path: SelectionPath | null = null;
    /** The user moved the level (keys, bar): it holds while the cursor stays inside the selection. */
    private adjusted = false;
    /** Space: the mouse no longer changes the selection. */
    private locked = false;
    private readings: Reading[] = [];
    private readingIndex = 0;
    private stateTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleClick = this.handleClick.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
    }

    public activate(
        strategy: ISelectionStrategy,
        onCancel: () => void
    ) {
        if (this.isActive) return;
        this.isActive = true;
        this.strategy = strategy;
        this.onCancelCallback = onCancel;

        this.createUI();
        this.attachEventListeners();
        console.log('✅ VisualElementPicker activated with strategy');
    }

    public deactivate() {
        if (!this.isActive) return;
        this.isActive = false;
        this.busy = false;
        this.strategy = null;
        this.removeUI();
        this.removeEventListeners();
        this.currentElement = null;
        this.path = null;
        if (this.stateTimer) { clearTimeout(this.stateTimer); this.stateTimer = null; }
        void send('PICKER_STATE', null);
        console.log('❌ VisualElementPicker deactivated');
    }

    /**
     * An action from the side panel or the bar: `wider`, `narrower`, `prev`, `next`, `lock`,
     * `select`, `reading:<i>`, `step:<i>` (also the keys' names: ArrowUp, ArrowDown, Enter).
     */
    public handleExternalAction(action: string) {
        if (!this.isActive || !this.path) return;
        const [name, arg] = action.split(':');
        switch (name) {
            case 'ArrowUp': case 'wider': this.move(() => this.path!.wider()); break;
            case 'ArrowDown': case 'narrower': this.move(() => this.path!.narrower()); break;
            case 'ArrowLeft': case 'prev': this.move(() => this.path!.sibling(-1)); break;
            case 'ArrowRight': case 'next': this.move(() => this.path!.sibling(1)); break;
            case 'step': this.move(() => this.path!.at(Number(arg))); break;
            case 'lock': this.locked = !this.locked; this.render(true); break;
            case 'reading': this.chooseReading(Number(arg)); break;
            case 'Enter': case 'select': this.select(); break;
        }
    }

    // ---- Selection ----

    /** A new element under the cursor: a fresh path, unless the user's level holds. */
    private hover(target: HTMLElement) {
        if (this.locked) return;
        if (this.adjusted && this.path?.current.contains(target)) return;
        if (!this.adjusted && this.path?.start === target) return;
        this.path = new SelectionPath(target);
        this.adjusted = false;
        this.update(false);
    }

    private move(step: () => boolean) {
        if (!this.path || !step()) return;
        this.adjusted = true;
        this.update(true);
    }

    /** The selection changed: its readings, its outline, the bar. */
    private update(redraw: boolean) {
        if (!this.path || !this.strategy) return;
        this.currentElement = this.path.current;
        this.readings = this.strategy.readings?.(this.currentElement) ?? [];
        this.readingIndex = 0;
        this.render(redraw);
    }

    private chooseReading(i: number) {
        if (i < 0 || i >= this.readings.length) return;
        this.readingIndex = i;
        this.render(true);
    }

    private get reading(): Reading | undefined {
        return this.readings[this.readingIndex];
    }

    /**
     * `redraw`: the user changed the level or the reading, so the outline is drawn again even when
     * it is the same element. A plain hover keeps the outline while the cursor moves inside it.
     */
    private render(redraw: boolean) {
        if (!this.currentElement || !this.strategy) return;
        if (redraw) this.lastHighlightedElement = null;
        this.strategy.handleHover(this.currentElement, this, this.reading);
        this.renderBar();
        // The side panel's mirror: the latest state, at most every STATE_MS.
        this.stateTimer ??= setTimeout(() => {
            this.stateTimer = null;
            if (this.isActive && this.path) void send('PICKER_STATE', this.state());
        }, STATE_MS);
    }

    private select() {
        if (!this.strategy || !this.currentElement || this.busy) return;
        this.strategy.handleClick(this.currentElement, this, reportSelection, this.reading);
    }

    private state() {
        const path = this.path!;
        return {
            steps: path.steps.map(step => stepLabel(step, path.twins.get(step))).reverse(),
            index: path.steps.length - 1 - path.index,
            readings: this.readings.map(r => r.label),
            reading: this.readingIndex,
            locked: this.locked,
            canPrev: !!path.current.previousElementSibling,
            canNext: !!path.current.nextElementSibling,
        };
    }

    // ---- UI ----

    private createUI() {
        // 1. Overlay
        this.overlay = document.createElement('div');
        this.overlay.setAttribute('data-testid', 'element-picker-overlay');
        this.overlay.style.cssText = `
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 2147483645 !important;
            background-color: rgba(0, 0, 0, 0.2) !important;
            cursor: crosshair !important;
            pointer-events: all !important;
            display: block !important;
        `;

        // 2. Highlight Box (Main)
        this.highlightBox = document.createElement('div');
        this.highlightBox.setAttribute('data-testid', 'element-picker-highlight');
        this.highlightBox.style.cssText = `
            position: fixed !important;
            z-index: 2147483646 !important;
            pointer-events: none !important;
            border: 2px solid #22D3EE !important;
            background-color: rgba(34, 211, 238, 0.1) !important;
            box-shadow: 0 0 0 4000px rgba(0, 0, 0, 0.3), 0 0 10px rgba(34, 211, 238, 0.7) !important;
            transition: all 0.1s ease-out !important;
            display: none !important;
            border-radius: 4px !important;
        `;

        // 3. Tooltip
        this.tooltip = document.createElement('div');
        this.tooltip.setAttribute('data-testid', 'element-picker-tooltip');
        this.tooltip.style.cssText = `
            position: fixed !important;
            z-index: 2147483647 !important;
            padding: 8px 12px !important;
            background-color: #22D3EE !important;
            color: black !important;
            border-radius: 6px !important;
            font-weight: bold !important;
            font-size: 13px !important;
            font-family: system-ui, -apple-system, sans-serif !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
            pointer-events: none !important;
            display: none !important;
            max-width: 300px !important;
            white-space: nowrap !important;
        `;

        // 4. The bar (fixed bottom-center): the path, the readings, and a button for every key.
        this.bar = document.createElement('div');
        this.bar.setAttribute('data-testid', 'element-picker-bar');
        this.bar.style.cssText = `
            position: fixed !important;
            bottom: 16px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            z-index: 2147483647 !important;
            background: rgba(17, 24, 39, 0.94) !important;
            color: #e5e7eb !important;
            border: 1px solid rgba(255,255,255,0.12) !important;
            border-radius: 10px !important;
            padding: 8px 12px !important;
            font: 12px system-ui, -apple-system, sans-serif !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 6px !important;
            pointer-events: auto !important;
            cursor: default !important;
            backdrop-filter: blur(4px) !important;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
            max-width: min(760px, calc(100vw - 32px)) !important;
        `;
        this.renderBar();

        document.documentElement.appendChild(this.overlay);
        document.documentElement.appendChild(this.highlightBox);
        document.documentElement.appendChild(this.tooltip);
        document.documentElement.appendChild(this.bar);
    }

    private renderBar() {
        if (!this.bar) return;
        const chip = (action: string, text: string, on = false, title = '') =>
            `<button type="button" data-action="${action}" title="${esc(title)}" style="all:unset;cursor:pointer;padding:2px 7px;border-radius:999px;white-space:nowrap;${on ? 'background:#22D3EE;color:#000;font-weight:700;' : 'background:rgba(255,255,255,0.1);'}">${esc(text)}</button>`;
        const key = (action: string, k: string, text: string, on = false) =>
            `<button type="button" data-action="${action}" style="all:unset;cursor:pointer;display:flex;align-items:center;gap:5px;${on ? 'color:#22D3EE;' : ''}"><kbd style="background:rgba(255,255,255,0.15);border-radius:3px;padding:1px 5px;font-weight:600;font-family:inherit;">${k}</kbd><span style="opacity:0.8;">${text}</span></button>`;

        let pathRow = '';
        if (this.path) {
            const s = this.state();
            const from = Math.max(0, s.index - STEPS_ABOVE);
            const crumbs = s.steps.slice(from).map((label, i) => {
                const at = from + i;
                return chip(`step:${this.path!.steps.length - 1 - at}`, label, at === s.index, 'Select this level');
            });
            pathRow = `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">${from > 0 ? '<span style="opacity:.6">…</span>' : ''}${crumbs.join('<span style="opacity:.5">›</span>')}</div>`;
        }
        const readingRow = this.readings.length > 1
            ? `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;"><span style="opacity:.7;margin-right:2px;">Read as</span>${this.readings.map((r, i) => chip(`reading:${i}`, r.label, i === this.readingIndex)).join('')}</div>`
            : '';
        const keys = `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">${[
            key('wider', '↑', 'Wider'),
            key('narrower', '↓', 'Narrower'),
            key('prev', '←', 'Prev'),
            key('next', '→', 'Next'),
            key('lock', '␣', this.locked ? 'Locked' : 'Lock', this.locked),
            key('select', 'Enter', 'Select'),
            key('cancel', 'Esc', 'Cancel'),
        ].join('')}</div>`;
        this.bar.innerHTML = pathRow + readingRow + keys;
    }

    private removeUI() {
        this.overlay?.remove();
        this.highlightBox?.remove();
        this.tooltip?.remove();
        this.bar?.remove();
        this.clearSiblingHighlights();
        this.overlay = null;
        this.highlightBox = null;
        this.tooltip = null;
        this.bar = null;
    }

    private clearSiblingHighlights() {
        this.siblingHighlights.forEach(({ box }) => box.remove());
        this.siblingHighlights = [];
    }

    private attachEventListeners() {
        document.addEventListener('mousemove', this.handleMouseMove, true);
        document.addEventListener('click', this.handleClick, true);
        document.addEventListener('keydown', this.handleKeyDown, true);
        document.addEventListener('scroll', this.handleScroll, { passive: true, capture: true });
        document.addEventListener('wheel', this.handleWheel, { passive: false, capture: true });
    }

    private removeEventListeners() {
        document.removeEventListener('mousemove', this.handleMouseMove, true);
        document.removeEventListener('click', this.handleClick, true);
        document.removeEventListener('keydown', this.handleKeyDown, true);
        document.removeEventListener('scroll', this.handleScroll, true);
        document.removeEventListener('wheel', this.handleWheel, true);
    }

    private handleMouseMove(e: MouseEvent) {
        if (this.busy || this.rafPending || !this.overlay || !this.strategy) return;
        this.rafPending = true;

        requestAnimationFrame(() => {
            this.rafPending = false;
            if (!this.overlay || !this.strategy) return;

            this.overlay.style.setProperty('pointer-events', 'none', 'important');
            const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
            this.overlay.style.setProperty('pointer-events', 'all', 'important');

            if (!target || target === this.overlay || target === document.body || target === document.documentElement) return;
            if (this.bar?.contains(target)) return;
            this.hover(target);
        });
    }

    /** Alt + scroll: wider / narrower (plain scroll still scrolls the page). */
    private handleWheel(e: WheelEvent) {
        if (!this.isActive || !e.altKey || !this.path) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY < 0) this.move(() => this.path!.wider());
        else if (e.deltaY > 0) this.move(() => this.path!.narrower());
    }

    public updateHighlightManual(
        element: HTMLElement,
        label: string,
        subLabel: string,
        anchorElement?: HTMLElement | null,
        siblings?: HTMLElement[]
    ) {
        if (!this.highlightBox || !this.tooltip) return;

        // Optimized check: Don't re-create highlight boxes if the container hasn't changed
        // This prevents flickering while moving the cursor WITHIN a card/container
        const siblingsChanged = siblings ? (
            siblings.length !== this.lastSiblings.length ||
            siblings.some((s, i) => s !== this.lastSiblings[i])
        ) : (this.lastSiblings.length > 0);

        // The outlined element (a list's container, say) is what matters, not the hovered one.
        if (this.lastHighlightedElement === element && !siblingsChanged) {
            // BUT we still want the tooltip to follow the cursor (anchorElement)
            const anchorRect = anchorElement ? anchorElement.getBoundingClientRect() : element.getBoundingClientRect();
            this.positionTooltip(anchorRect);
            return;
        }

        this.lastHighlightedElement = element;
        this.lastSiblings = siblings || [];

        // getVisualRect: display:contents items (LinkedIn cards) have a 0x0
        // bounding rect of their own — union their children so boxes stay visible
        const rect = getVisualRect(element);
        const anchorRect = anchorElement ? getVisualRect(anchorElement) : rect;

        // Update highlight box
        this.highlightBox.style.display = 'block';
        this.highlightBox.style.top = `${rect.top}px`;
        this.highlightBox.style.left = `${rect.left}px`;
        this.highlightBox.style.width = `${rect.width}px`;
        this.highlightBox.style.height = `${rect.height}px`;

        // Update Sibling Highlights
        this.clearSiblingHighlights();
        if (siblings && siblings.length > 0) {
            siblings.forEach(sibling => {
                // Don't highlight the container itself if it's in the list (unlikely)
                if (sibling === element) return;

                const sRect = getVisualRect(sibling);
                if (sRect.width === 0 && sRect.height === 0) return;
                const box = document.createElement('div');
                box.style.cssText = `
                    position: fixed !important;
                    z-index: 2147483646 !important;
                    pointer-events: none !important;
                    border: 2px dashed rgba(34, 211, 238, 0.8) !important;
                    background-color: rgba(34, 211, 238, 0.05) !important;
                    top: ${sRect.top}px !important;
                    left: ${sRect.left}px !important;
                    width: ${sRect.width}px !important;
                    height: ${sRect.height}px !important;
                    display: block !important;
                    border-radius: 2px !important;
                `;
                document.documentElement.appendChild(box);
                this.siblingHighlights.push({ target: sibling, box });
            });
        }

        // Update tooltip content
        const tag = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';

        const mainText = label || `${tag}${id}${className}`;
        const secondaryText = this.locked ? 'Locked · Space to unlock · Enter to select' : subLabel || 'Click to select';

        this.tooltip.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 2px;">${esc(mainText)}</div>
            <div style="font-size: 11px; opacity: 0.9;">${esc(secondaryText)}</div>
        `;
        this.tooltip.style.display = 'block';

        // Position tooltip based on Anchor (cursor/hovered element) or Main Element
        this.positionTooltip(anchorRect);
    }

    /**
     * Says a pick is being read ("Reading 45 items…") and resolves once that has been drawn: the
     * fields are worked out next, which takes seconds on a slow computer.
     */
    public showBusy(text: string): Promise<void> {
        this.busy = true;
        const line = this.tooltip?.lastElementChild as HTMLElement | null | undefined;
        if (line) line.textContent = text;
        this.overlay?.style.setProperty('cursor', 'progress', 'important');
        // A frame to draw it (a timer too, in case frames don't run).
        return new Promise(resolve => {
            const done = () => setTimeout(resolve, 0);
            requestAnimationFrame(done);
            setTimeout(done, 100);
        });
    }

    /** Back to picking (a pick that failed): the user can click again. */
    public clearBusy() {
        this.busy = false;
        this.overlay?.style.setProperty('cursor', 'crosshair', 'important');
    }

    private positionTooltip(rect: DOMRect) {
        if (!this.tooltip) return;
        const tooltipRect = this.tooltip.getBoundingClientRect();
        const padding = 10;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Default position: Top Center of rect
        let top = rect.top - tooltipRect.height - padding;
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

        // If off-screen top, move to bottom
        if (top < padding) {
            top = rect.bottom + padding;
        }

        // Ensure bottom doesn't overflow
        if (top + tooltipRect.height > viewportHeight - padding) {
            // If both top and bottom are tight, stick to bottom of viewport or just clamp
            top = Math.min(top, viewportHeight - tooltipRect.height - padding);
        }

        // Ensure top is never negative (fallback)
        top = Math.max(padding, top);

        // Horizontal Clamping
        left = Math.max(padding, left); // Left edge
        left = Math.min(left, viewportWidth - tooltipRect.width - padding); // Right edge

        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.left = `${left}px`;
    }

    private handleClick(e: MouseEvent) {
        // Clicks in the interactions editor (a shadow root) are its own.
        const path = e.composedPath();
        for (const el of path) {
            if (el instanceof HTMLElement && el.id === 'crawl-pilot-editor-host') {
                return;
            }
        }

        if (!this.isActive || !this.strategy) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // The bar's buttons.
        const button = path.find(el => el instanceof HTMLElement && this.bar?.contains(el) && el.dataset.action) as HTMLElement | undefined;
        if (button || path.includes(this.bar!)) {
            const action = button?.dataset.action;
            if (action === 'cancel') this.cancel();
            else if (action) this.handleExternalAction(action);
            return;
        }
        if (this.busy) return;
        this.select();
    }

    private cancel() {
        if (this.onCancelCallback) this.onCancelCallback();
        this.deactivate();
    }

    private handleKeyDown(e: KeyboardEvent) {
        if (!this.isActive) return;
        const stop = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
        if (e.key === 'Escape') {
            console.log('🛑 [Picker] Escape key detected, cancelling...');
            stop();
            this.cancel();
            return;
        }
        if (!this.path) return;
        const keys: Record<string, string> = {
            ArrowUp: 'wider', '[': 'wider', ArrowDown: 'narrower', ']': 'narrower',
            ArrowLeft: 'prev', ArrowRight: 'next', ' ': 'lock', Enter: 'select',
        };
        let action = keys[e.key];
        // L / T / V: read as a list, a table (or the items like this), one value.
        const letter = e.key.toLowerCase();
        if (!action && ['l', 't', 'v'].includes(letter) && !e.metaKey && !e.ctrlKey) {
            const want = letter === 'v' ? ['value'] : letter === 'l' ? ['list', 'array'] : ['items', 'list'];
            const i = this.readings.findIndex(r => want.includes(r.kind) && (letter !== 't' || r.kind === 'items' || r.label.startsWith('Table')));
            if (i >= 0) action = `reading:${i}`;
        }
        if (!action) return;
        stop();
        this.handleExternalAction(action);
    }

    private handleScroll() {
        // Track the highlighted container (what the box actually outlines),
        // not the hovered leaf — otherwise the box jumps to the leaf on scroll.
        const tracked = this.lastHighlightedElement || this.currentElement;
        if (tracked && this.highlightBox) {
            const rect = getVisualRect(tracked);
            this.highlightBox.style.top = `${rect.top}px`;
            this.highlightBox.style.left = `${rect.left}px`;
            this.highlightBox.style.width = `${rect.width}px`;
            this.highlightBox.style.height = `${rect.height}px`;
        }
        // Keep sibling boxes glued to their elements while scrolling
        this.siblingHighlights.forEach(({ target, box }) => {
            const r = getVisualRect(target);
            box.style.top = `${r.top}px`;
            box.style.left = `${r.left}px`;
            box.style.width = `${r.width}px`;
            box.style.height = `${r.height}px`;
        });
    }
}
