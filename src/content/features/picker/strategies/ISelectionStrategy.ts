import { VisualElementPicker } from '../VisualElementPicker';

export interface ISelectionStrategy {
    handleHover(element: HTMLElement, picker: VisualElementPicker): void;
    handleClick(element: HTMLElement, picker: VisualElementPicker, sendResponse: (msg: any) => void): void;

    // NEW: Optional keyboard handling
    handleKeyboard?(event: KeyboardEvent, picker: VisualElementPicker): void;

    preferredAction?: 'extract' | 'click';
}
