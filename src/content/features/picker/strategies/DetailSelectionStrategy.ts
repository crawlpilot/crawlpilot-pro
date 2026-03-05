import { ISelectionStrategy } from './ISelectionStrategy';
import { VisualElementPicker } from '../VisualElementPicker';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { ContainerDetector } from '../ContainerDetector';
import { generateCssSelector, generateXPath, clickElementRobust } from '../../../services/dom/domUtils';

export class DetailSelectionStrategy implements ISelectionStrategy {
    private extractor: DataExtractor;
    private detector: ContainerDetector;

    public preferredAction?: 'extract' | 'click' = 'extract';

    // Shared state: computed once in handleHover, reused by handleClick.
    // This guarantees the highlighted element = the selected element.
    private lastContainerInfo: any = null;
    private lastHighlightedElement: HTMLElement | null = null;

    constructor() {
        this.extractor = new DataExtractor();
        this.detector = new ContainerDetector();
    }

    /**
     * Detect the container for this element (inside-first, then walk up).
     * Shared logic used by both hover and click.
     */
    private detectContainer(element: HTMLElement) {
        // Phase A: look inside
        let containerInfo = this.detector.findInternalContainer(element);

        // Phase B: walk up if nothing inside (user is hovering/clicking a child)
        if (!containerInfo.isContainer) {
            let ancestor: HTMLElement | null = element.parentElement;
            for (let up = 0; up < 6 && ancestor && ancestor !== document.body; up++) {
                const parentInfo = this.detector.findInternalContainer(ancestor);
                if (parentInfo.isContainer) {
                    containerInfo = parentInfo;
                    break;
                }
                ancestor = ancestor.parentElement;
            }
        }
        return containerInfo;
    }

    handleHover(element: HTMLElement, picker: VisualElementPicker): void {
        const containerInfo = this.detectContainer(element);

        // Highlight the actual container so what you see = what you get on click
        const highlightTarget =
            containerInfo.isContainer && containerInfo.container
                ? containerInfo.container as HTMLElement
                : element;

        // Cache for handleClick — no need to recalculate
        this.lastContainerInfo = containerInfo;
        this.lastHighlightedElement = highlightTarget;

        picker.updateHighlightManual(
            highlightTarget,
            'Select Element',
            'Click to edit & extract',
            undefined,
            []
        );
    }

    handleClick(element: HTMLElement, picker: VisualElementPicker, sendResponse: (msg: any) => void): void {
        console.log('Detail Strategy Clicked:', element);

        // Use the container that was highlighted to the user.
        // If no hover ran (e.g. touch/keyboard click), fall back to fresh detection.
        const containerInfo =
            this.lastContainerInfo ?? this.detectContainer(element);
        const target =
            (containerInfo.isContainer && containerInfo.container)
                ? containerInfo.container as HTMLElement
                : (this.lastHighlightedElement ?? element);

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

            const itemSpecificSelector = generateCssSelector(target, false);
            const itemSpecificXPath = generateXPath(target);

            itemSelector = itemSpecificSelector;
            itemXPath = itemSpecificXPath;

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
            autoExtractionType = containerInfo.containerType === 'table' ? 'table' : 'list';
            const typeStr = autoExtractionType === 'table' ? 'Table' : 'List';
            previewValue = `${typeStr} (${itemCount} items)`;
            finalValue = previewValue;
        } else if (target.tagName === 'IMG') {
            autoExtractionType = 'image';
            previewValue = (target as HTMLImageElement).src;
            finalValue = previewValue;
        } else if (target.tagName === 'A') {
            autoExtractionType = 'link';
            previewValue = (target as HTMLAnchorElement).href;
            finalValue = previewValue;
        } else {
            autoExtractionType = 'text';
            previewValue = target.textContent?.trim().substring(0, 50) || '';
            finalValue = target.textContent?.trim() || '';
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
                tagName: target.tagName.toLowerCase(),
                selectionMode: 'detail',
                action: this.preferredAction || 'extract',
                extractionType: autoExtractionType,
                waitTime: 0,
                patternFound: isList,
                count: isList ? (containerInfo.childCount || data?.items?.length || 1) : 1
            }
        });

        picker.deactivate();

        // Reset shared state after use
        this.lastContainerInfo = null;
        this.lastHighlightedElement = null;

        // [NEW] If action is click, actually perform it so user can proceed
        if (this.preferredAction === 'click') {
            console.log('👆 Triggering robust click on element:', target);

            if (typeof target.click === 'function') {
                target.click();
            }

            setTimeout(async () => {
                await clickElementRobust(target);
            }, 100);
        }

    }
}



