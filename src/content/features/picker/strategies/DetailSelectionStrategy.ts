import { ISelectionStrategy } from './ISelectionStrategy';
import { VisualElementPicker } from '../VisualElementPicker';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { ContainerDetector } from '../ContainerDetector';
import { generateCssSelector, generateXPath, clickElementRobust } from '../../../services/dom/domUtils';

export class DetailSelectionStrategy implements ISelectionStrategy {
    private extractor: DataExtractor;
    private detector: ContainerDetector;

    public preferredAction?: 'extract' | 'click' = 'extract';

    constructor() {
        this.extractor = new DataExtractor();
        this.detector = new ContainerDetector();
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

        // Use ContainerDetector to see if this is a list/table.
        // We look INSIDE the selected element first.
        const containerInfo = this.detector.findInternalContainer(target);
        const isList = containerInfo.isContainer && containerInfo.container;

        let containerSelector = '';
        let containerXPath = '';
        let itemSelector = '';
        let itemXPath = '';
        let data: any = {};

        if (isList) {
            console.log('[DetailStrategy] Detected list/table container:', containerInfo);
            containerSelector = generateCssSelector(containerInfo.container!);
            containerXPath = generateXPath(containerInfo.container!);

            // In Detail Selection (Page Extraction), we must generate a STRICT selector 
            // scoped to the specific target element to avoid broad matching that hangs large pages (e.g. Amazon)
            const itemSpecificSelector = generateCssSelector(target, false);
            const itemSpecificXPath = generateXPath(target);

            itemSelector = itemSpecificSelector;
            itemXPath = itemSpecificXPath;

            // Extract all items in the list
            data = this.extractor.extract(target, containerInfo);

        } else {
            console.log('[DetailStrategy] No list detected. Extracting single element.');
            containerSelector = generateCssSelector(target);
            containerXPath = generateXPath(target);
            itemSelector = containerSelector;
            itemXPath = containerXPath;

            data = this.extractor.extract(target, { isContainer: false, siblings: [], container: null });
        }

        // Calculate simple preview value based on extraction type
        let previewValue = '';
        let finalValue = '';
        let autoExtractionType: 'text' | 'link' | 'image' | 'list' | 'table' = 'text';

        const columnCount = data?.columns?.length || 0;
        const itemCount = isList ? (containerInfo.childCount || data?.items?.length || 0) : 1;

        if (columnCount > 1) {
            autoExtractionType = 'table';
            previewValue = `Table (${columnCount} fields)`;
            finalValue = previewValue;
        } else if (isList) {
            autoExtractionType = 'list';
            previewValue = `List (${itemCount} items)`;
            finalValue = previewValue;
        } else if (element.tagName === 'IMG') {
            autoExtractionType = 'image';
            previewValue = (element as HTMLImageElement).src;
            finalValue = previewValue;
        } else if (element.tagName === 'A') {
            autoExtractionType = 'link';
            previewValue = (element as HTMLAnchorElement).href;
            finalValue = previewValue;
        } else {
            autoExtractionType = 'text';
            previewValue = element.textContent?.trim().substring(0, 50) || '';
            finalValue = element.textContent?.trim() || '';
        }

        sendResponse({
            type: 'ELEMENT_SELECTED',
            payload: {
                success: true,
                id: `sel-${Date.now()}`,
                data: data,
                containerSelector: containerSelector,
                containerXPath: containerXPath,
                itemSelector: itemSelector,
                itemXPath: itemXPath,
                value: finalValue,
                previewValue: previewValue,
                tagName: element.tagName.toLowerCase(),
                selectionMode: 'detail',
                action: this.preferredAction || 'extract', // Use preferred action
                extractionType: autoExtractionType,
                waitTime: 0,
                patternFound: isList,
                count: isList ? (containerInfo.childCount || data?.items?.length || 1) : 1
            }
        });

        picker.deactivate();

        // [NEW] If action is click, actually perform it so user can proceed
        if (this.preferredAction === 'click') {
            console.log('👆 Triggering robust click on element:', element);

            // Synchronous native click FIRST to preserve User Gesture (Transient Activation)
            // This is required for navigating <a> tags or triggering native popups.
            if (typeof element.click === 'function') {
                element.click();
            }

            // Slightly longer delay to ensure overlay is gone and DOM is stable for JS-bound events
            setTimeout(async () => {
                await clickElementRobust(element);
            }, 100);
        }

    }
}
