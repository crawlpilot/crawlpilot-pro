/**
 * Handles the visual selection UI (overlay, tooltip, highlighting)
 */
import { ISelectionStrategy } from './strategies/ISelectionStrategy';
export class VisualElementPicker {
    private overlay: HTMLElement | null = null;
    private tooltip: HTMLElement | null = null;
    private highlightBox: HTMLElement | null = null;
    private siblingHighlights: HTMLElement[] = []; // Stores dashed boxes
    private currentElement: HTMLElement | null = null;
    private isActive: boolean = false;
    private strategy: ISelectionStrategy | null = null;
    private onCancelCallback: (() => void) | null = null;
    private lastHighlightedElement: HTMLElement | null = null;
    private lastSiblings: HTMLElement[] = [];

    constructor() {
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleClick = this.handleClick.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
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
        this.strategy = null;
        this.removeUI();
        this.removeEventListeners();
        this.currentElement = null;
        console.log('❌ VisualElementPicker deactivated');
    }

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
            border: 2px solid #2563EB !important;
            background-color: rgba(37, 99, 235, 0.1) !important;
            box-shadow: 0 0 0 4000px rgba(0, 0, 0, 0.3), 0 0 10px rgba(37, 99, 235, 0.7) !important;
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
            background-color: #2563EB !important;
            color: white !important;
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

        document.documentElement.appendChild(this.overlay);
        document.documentElement.appendChild(this.highlightBox);
        document.documentElement.appendChild(this.tooltip);
    }

    private removeUI() {
        this.overlay?.remove();
        this.highlightBox?.remove();
        this.tooltip?.remove();
        this.clearSiblingHighlights();
        this.overlay = null;
        this.highlightBox = null;
        this.tooltip = null;
    }

    private clearSiblingHighlights() {
        this.siblingHighlights.forEach(el => el.remove());
        this.siblingHighlights = [];
    }

    private attachEventListeners() {
        document.addEventListener('mousemove', this.handleMouseMove, true);
        document.addEventListener('click', this.handleClick, true);
        document.addEventListener('keydown', this.handleKeyDown, true);
        window.addEventListener('keydown', this.handleKeyDown, true);
        document.addEventListener('scroll', this.handleScroll, { passive: true, capture: true });
    }

    private removeEventListeners() {
        document.removeEventListener('mousemove', this.handleMouseMove, true);
        document.removeEventListener('click', this.handleClick, true);
        document.removeEventListener('keydown', this.handleKeyDown, true);
        window.removeEventListener('keydown', this.handleKeyDown, true);
        document.removeEventListener('scroll', this.handleScroll, true);
    }

    private handleMouseMove(e: MouseEvent) {
        if (!this.overlay || !this.strategy) return;

        // Temporarily hide overlay to find element underneath
        // Use setProperty to ensure we override any priority
        this.overlay.style.setProperty('pointer-events', 'none', 'important');
        const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
        this.overlay.style.setProperty('pointer-events', 'all', 'important');

        if (!target) return;

        // Debug Log (throttle if needed, but for now log every few moves or just rely on console)
        // console.log('[Picker] Hover target:', target.tagName, target.className);

        if (target === this.overlay || target === document.body || target === document.documentElement) {
            return;
        }

        if (this.currentElement !== target) {
            console.log('[Picker] New target detected:', target.tagName, target.className);
            this.currentElement = target;
            this.strategy.handleHover(target, this);
        }
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

        // CRITICAL DEBOUNCE FIX:
        // Check if the actual "primary highlighted element" (the container/box) has changed.
        // Previously we checked 'lastHighlightedElement', but that might refer to the previous *hover* target.
        // We need to ensure that if the 'element' (container) passed in changes, we update.
        if (this.lastHighlightedElement === element && !siblingsChanged) {
            // BUT we still want the tooltip to follow the cursor (anchorElement)
            const anchorRect = anchorElement ? anchorElement.getBoundingClientRect() : element.getBoundingClientRect();
            this.positionTooltip(anchorRect);
            return;
        }

        this.lastHighlightedElement = element;
        this.lastSiblings = siblings || [];

        // DO NOT update currentElement here. 
        // currentElement tracks the "Hovered" element (the trigger),
        // whereas 'element' here is the "Highlighted" element (the result).
        // Updating it causes an infinite loop in handleMouseMove and breaks click targeting.
        // this.currentElement = element;

        const rect = element.getBoundingClientRect();
        const anchorRect = anchorElement ? anchorElement.getBoundingClientRect() : rect;

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

                const sRect = sibling.getBoundingClientRect();
                const box = document.createElement('div');
                box.style.cssText = `
                    position: fixed !important;
                    z-index: 2147483646 !important;
                    pointer-events: none !important;
                    border: 2px dashed rgba(37, 99, 235, 0.8) !important;
                    background-color: rgba(37, 99, 235, 0.05) !important;
                    top: ${sRect.top}px !important;
                    left: ${sRect.left}px !important;
                    width: ${sRect.width}px !important;
                    height: ${sRect.height}px !important;
                    display: block !important;
                    border-radius: 2px !important;
                `;
                document.documentElement.appendChild(box);
                this.siblingHighlights.push(box);
            });
        }

        // Update tooltip content
        const tag = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';

        const mainText = label || `${tag}${id}${className}`;
        const secondaryText = subLabel || 'Click to select';

        this.tooltip.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 2px;">${mainText}</div>
            <div style="font-size: 11px; opacity: 0.9;">${secondaryText}</div>
        `;
        this.tooltip.style.display = 'block';

        // Position tooltip based on Anchor (cursor/hovered element) or Main Element
        this.positionTooltip(anchorRect);
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
        // IGNORE clicks on the interactions editor
        // Since we use capture=true, we interpret the event before it reaches the shadow DOM.
        // We must check if the target is our editor host.

        // Also check composed path for shadow roots
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

        // Use the currentElement identified by handleMouseMove
        // because the overlay captures the actual click event target.
        if (this.currentElement) {
            this.strategy.handleClick(this.currentElement, this, (msg) => {
                // Use runtime.sendMessage directly if available, otherwise fallback
                if (chrome && chrome.runtime) {
                    chrome.runtime.sendMessage(msg);
                }
            });
        }
    }

    private handleKeyDown(e: KeyboardEvent) {
        // High-priority escape check
        if (e.key === 'Escape') {
            console.log('🛑 [Picker] Escape key detected, cancelling...');
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (this.onCancelCallback) this.onCancelCallback();
            this.deactivate();
            return;
        }
    }

    private handleScroll() {
        if (this.currentElement && this.highlightBox) {
            const rect = this.currentElement.getBoundingClientRect();
            this.highlightBox.style.top = `${rect.top}px`;
            this.highlightBox.style.left = `${rect.left}px`;
        }
    }
}
