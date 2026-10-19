import type { ElementSelected } from '../../../../shared/messages';
import { ISelectionStrategy } from './ISelectionStrategy';
import { VisualElementPicker } from '../VisualElementPicker';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { nextButtonSelectors } from '../../../services/selectors/nextButton';

export class SingleSelectionStrategy implements ISelectionStrategy {
    private extractor: DataExtractor;

    public preferredAction?: 'extract' | 'click' = 'extract';

    constructor() {
        this.extractor = new DataExtractor();
    }

    handleHover(element: HTMLElement, picker: VisualElementPicker): void {
        picker.updateHighlightManual(
            element,
            'Next Button',
            'Click to select',
            undefined,
            []
        );
    }

    handleClick(element: HTMLElement, picker: VisualElementPicker, report: (selected: ElementSelected) => void): void {
        const data = this.extractor.extract(element, { isContainer: false, siblings: [], container: null, childCount: 0 });

        report({
            success: true,
            id: `sel-${Date.now()}`,
            data,
            // The Next / Load more control's chain (its clickable ancestor, its text, no page numbers).
            selectors: nextButtonSelectors(element).map(c => c.selector),
            count: 1,
            selectionMode: 'single'
        });

        picker.deactivate();

        // Click logic removed from selection phase to prevent unintended navigation

    }
}
