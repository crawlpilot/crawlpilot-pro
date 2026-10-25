import type { ElementSelected } from '../../../../shared/messages';
import { VisualElementPicker } from '../VisualElementPicker';

/**
 * One way a click can read the selected element (docs/plans/picker-level-control-plan.md §3.3):
 * its value, the list or table inside it, an array of like children, or the items like it around it.
 */
export interface Reading {
    kind: 'value' | 'list' | 'array' | 'items';
    /** What the user sees: "Text · $24.99", "List · 12 items", "Items like this · 24". */
    label: string;
    /** The elements outlined dashed with it (a list's items, the items like this one). */
    outlines?: HTMLElement[];
    /** The element outlined solid instead of the selection (the parent of the items like this). */
    outline?: HTMLElement;
    /** The one a strategy suggests (else the first). */
    suggested?: boolean;
    /** Strategies that step through readings: the level (a section, nearest first). */
    group?: number;
    /** Another way to read the same level (a grid's rows instead of its cards). */
    variant?: string;
    /** What the strategy needs to save it (a section's match). */
    data?: unknown;
}

export interface ISelectionStrategy {
    /** `reading`: the one shown for the selection, when the strategy offers readings. */
    handleHover(element: HTMLElement, picker: VisualElementPicker, reading?: Reading): void;
    /** `reading`: what the user chose to save; the click never re-decides it. */
    handleClick(element: HTMLElement, picker: VisualElementPicker, report: (selected: ElementSelected) => void, reading?: Reading): void;
    /** The ways a click can read `element` (the suggested one first, or marked `suggested`). */
    readings?(element: HTMLElement): Reading[];
    /**
     * Wider / Narrower step through the readings' groups (the List Extractor's sections) instead of
     * the element's path; ← / → don't apply.
     */
    stepsThroughReadings?: boolean;

    preferredAction?: 'extract' | 'click';
}
