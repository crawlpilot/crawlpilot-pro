import type { ElementSelected } from '../../../../shared/messages';
import { VisualElementPicker } from '../VisualElementPicker';

export interface ISelectionStrategy {
    handleHover(element: HTMLElement, picker: VisualElementPicker): void;
    handleClick(element: HTMLElement, picker: VisualElementPicker, report: (selected: ElementSelected) => void): void;

    preferredAction?: 'extract' | 'click';
}
