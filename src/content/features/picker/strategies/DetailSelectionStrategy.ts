import { ISelectionStrategy } from './ISelectionStrategy';
import { VisualElementPicker } from '../VisualElementPicker';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { LegacySelectorGenerator } from '../../../services/dom/LegacySelectorGenerator';

export class DetailSelectionStrategy implements ISelectionStrategy {
    private extractor: DataExtractor;

    constructor() {
        this.extractor = new DataExtractor();
    }

    handleHover(element: HTMLElement, picker: VisualElementPicker): void {
        picker.updateHighlightManual(
            element,
            'Select Element',
            'Click to edit & extract',
            undefined,
            []
        );
    }

    handleClick(element: HTMLElement, picker: VisualElementPicker, sendResponse: (msg: any) => void): void {
        console.log('Detail Strategy Clicked:', element);

        // We explicitly use the EXACT element for selectors, bypassing any "Smart Ancestor" logic 
        // to ensure Data Extractors match the exact node the user pointed to.
        const target = element;

        // Use LegacySelectorGenerator for strict port of reference logic
        const cssSelectors = LegacySelectorGenerator.generateCssSelectors(target);
        const xpathSelectors = LegacySelectorGenerator.generateXPathSelectors(target);

        const selector = cssSelectors.length > 0 ? cssSelectors[0] : '';
        const xpath = xpathSelectors.length > 0 ? xpathSelectors[0] : '';

        const data = this.extractor.extract(element, { isContainer: false, siblings: [], container: null });

        // Calculate simple preview value based on extraction type
        let previewValue = '';
        let finalValue = '';
        let autoExtractionType: 'text' | 'link' | 'image' = 'text';

        if (element.tagName === 'IMG') {
            autoExtractionType = 'image';
            previewValue = (element as HTMLImageElement).src;
            finalValue = previewValue;
        } else if (element.tagName === 'A') {
            autoExtractionType = 'link';
            previewValue = (element as HTMLAnchorElement).href;
            finalValue = previewValue;
        } else {
            autoExtractionType = 'text';
            // Auto fallback
            previewValue = element.textContent?.trim().substring(0, 50) || '';
            finalValue = element.textContent?.trim() || '';
        }

        sendResponse({
            type: 'ELEMENT_SELECTED',
            payload: {
                success: true,
                id: `sel-${Date.now()}`,
                data: data,
                containerSelector: selector,
                containerXPath: xpath,
                itemSelector: selector,
                itemXPath: xpath,
                value: finalValue,
                previewValue: previewValue,
                tagName: element.tagName.toLowerCase(),
                selectionMode: 'detail',
                action: 'extract', // Client UI manages the actual action initially
                extractionType: autoExtractionType,
                waitTime: 0,
                patternFound: false,
                count: 1
            }
        });

        picker.deactivate();
    }
}
