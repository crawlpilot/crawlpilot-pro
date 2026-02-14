import { ISelectionStrategy } from './ISelectionStrategy';
import { VisualElementPicker } from '../VisualElementPicker';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { LegacySelectorGenerator } from '../../../services/dom/LegacySelectorGenerator';
import { ElementEditorPopup } from '../../../ui/ElementEditorPopup';

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

        // Smart Target Logic: Prefer interactive ancestors (a, button)
        let target = element;
        let curr: HTMLElement | null = element;
        for (let i = 0; i < 4; i++) {
            if (!curr) break;
            const tag = curr.tagName.toLowerCase();
            const role = curr.getAttribute('role');
            if (['a', 'button', 'input', 'select', 'details', 'summary'].includes(tag) || role === 'button' || role === 'link') {
                target = curr;
                console.log('⚡️ Adjusted selection to interactive ancestor:', target);
                break;
            }
            curr = curr.parentElement;
        }

        // Use LegacySelectorGenerator for strict port of reference logic (on the interactive target)
        const cssSelectors = LegacySelectorGenerator.generateCssSelectors(target);
        const xpathSelectors = LegacySelectorGenerator.generateXPathSelectors(target);

        const selector = cssSelectors.length > 0 ? cssSelectors[0] : '';
        const xpath = xpathSelectors.length > 0 ? xpathSelectors[0] : '';

        // Pause picker visual updates implicitly by covering with popup
        if (picker['overlay']) picker['overlay'].style.pointerEvents = 'none';

        const popup = new ElementEditorPopup();

        popup.show(
            element,
            selector,
            xpath,
            (result) => {
                // On Save
                const data = this.extractor.extract(element, { isContainer: false, siblings: [], container: null });

                if (result.action === 'click') {
                    // Execute the click immediately so the user can see the effect (e.g. modal opens)
                    // We use a small timeout to let the popup close first
                    setTimeout(() => {
                        console.log('⚡️ Executing immediate click for verification:', element);

                        // 1. Standard click
                        try { element.click(); } catch (e) { }

                        // 2. Dispatch comprehensive mouse events for React/Vue/Angular
                        const eventOptions = {
                            view: window,
                            bubbles: true,
                            cancelable: true,
                            buttons: 1,
                            composed: true
                        };

                        element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
                        element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
                        element.dispatchEvent(new MouseEvent('click', eventOptions));

                    }, 50);
                } else {
                    // Usual Extraction Logic (only needed if NOT just a pure interaction? 
                    // actually we still send the response regardless)
                }

                // Calculate simple preview value based on extraction type
                let previewValue = '';
                let finalValue = '';

                if (result.extractionType === 'image' && element.tagName === 'IMG') {
                    previewValue = (element as HTMLImageElement).src;
                    finalValue = previewValue;
                } else if (result.extractionType === 'link' && element.tagName === 'A') {
                    previewValue = (element as HTMLAnchorElement).href;
                    finalValue = previewValue;
                } else if (result.extractionType === 'text') {
                    previewValue = element.innerText?.trim().substring(0, 50) || '';
                    finalValue = element.innerText?.trim() || '';
                } else {
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
                        containerSelector: result.selector,
                        containerXPath: result.xpath,
                        itemSelector: result.selector,
                        itemXPath: result.xpath,
                        value: finalValue,
                        previewValue: previewValue,
                        tagName: result.name || element.tagName.toLowerCase(),
                        selectionMode: 'detail',
                        action: result.action,
                        extractionType: result.extractionType,
                        waitTime: result.waitTime,
                        patternFound: false,
                        count: 1
                    }
                });

                picker.deactivate();
                if (picker['overlay']) picker['overlay'].style.pointerEvents = 'all';
            },
            () => {
                // On Cancel
                console.log('Selection cancelled, resuming picker');
                if (picker['overlay']) picker['overlay'].style.pointerEvents = 'all';
                // We don't deactivate, effectively resuming selection
            }
        );
    }
}
