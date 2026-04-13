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
        const isList = !!(containerInfo.isContainer && containerInfo.container);

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

        const itemCount = isList ? (containerInfo.childCount || data?.items?.length || 0) : 1;

        if (isList) {
            // containerType is computed by determineContainerType using structural analysis:
            // TABLE/UL/OL/TBODY → 'table' (rows), everything else → 'list' (columns)
            autoExtractionType = containerInfo.containerType === 'table' ? 'table' : 'list';
            const typeStr = autoExtractionType === 'table' ? 'Table' : 'List';
            previewValue = `${typeStr} (${itemCount} items)`;
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
            // Enhanced auto-detection for wrapper elements
            // Check if element contains a single dominant image
            const images = element.querySelectorAll('img');
            const textContent = (element.textContent || '').trim();
            if (images.length === 1 && textContent.length < 20) {
                autoExtractionType = 'image';
                previewValue = (images[0] as HTMLImageElement).src;
                finalValue = previewValue;
            }
            // Check if element is/contains a single dominant link
            else if (element.querySelector('a[href]') && !element.querySelector('a[href] ~ a[href]')) {
                const anchor = element.querySelector('a[href]') as HTMLAnchorElement;
                if (anchor && anchor.href && !anchor.href.startsWith('javascript:')) {
                    autoExtractionType = 'link';
                    previewValue = anchor.href;
                    finalValue = previewValue;
                }
            }
            // Check for background-image
            else {
                try {
                    const bgImage = window.getComputedStyle(element).backgroundImage;
                    if (bgImage && bgImage !== 'none' && bgImage.startsWith('url(')) {
                        autoExtractionType = 'image';
                        previewValue = bgImage.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
                        finalValue = previewValue;
                    }
                } catch (_) { /* ignore */ }
            }

            // Sibling-pattern heuristic: if the element is part of a repeating structure
            // at its IMMEDIATE parent level (e.g., one row of a spec table), auto-tag as 'table'
            // and re-target the selector to the parent container.
            // We only go UP ONE level to avoid accidentally selecting the entire page.
            if (autoExtractionType === 'text') {
                const parent = element.parentElement;
                if (parent && parent !== document.body && parent !== document.documentElement) {
                    const siblingTag = element.tagName;
                    const childCount = element.children.length;
                    const siblings = Array.from(parent.children) as HTMLElement[];
                    const matchingSiblings = siblings.filter(sib =>
                        sib.tagName === siblingTag &&
                        Math.abs(sib.children.length - childCount) <= 1 &&
                        sib.offsetHeight > 0 &&
                        (sib.textContent || '').trim().length > 0
                    );

                    if (matchingSiblings.length >= 3 && childCount >= 2) {
                        // Strong sibling pattern detected — this is a spec table / key-value list
                        autoExtractionType = 'table';
                        containerSelector = generateCssSelector(parent);
                        containerXPath = generateXPath(parent);
                        itemSelector = containerSelector;
                        itemXPath = containerXPath;
                        previewValue = `Table (${matchingSiblings.length} items)`;
                        finalValue = previewValue;
                    }
                }
            }

            // Default: text
            if (autoExtractionType === 'text') {
                previewValue = textContent.substring(0, 50) || '';
                finalValue = textContent || '';
            }
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

            // Delay to ensure overlay is gone and DOM is stable for JS-bound events
            setTimeout(async () => {
                await clickElementRobust(element);
            }, 100);
        }

    }
}
