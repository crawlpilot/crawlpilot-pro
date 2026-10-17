import type { ElementSelected } from '../../../../shared/messages';
import { ISelectionStrategy } from './ISelectionStrategy';
import { VisualElementPicker } from '../VisualElementPicker';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { refreshNetSources } from '../../../services/extraction/structuredRows';
import { findList, itemOf, ListMatch } from '../../../services/extraction/items';
import { withAtomCache } from '../../../services/extraction/atoms';
import { listLocators } from '../../../services/selectors/specs';
import { elementChain } from '../../../services/selectors/element';
import { looksLikeXPath } from '../../../../shared/selectors/resolve';

export class ListSelectionStrategy implements ISelectionStrategy {
    private extractor: DataExtractor;
    private lastContainerInfo: ListMatch | null = null;
    private lastItemUnit: HTMLElement | null = null;
    public preferredAction?: 'extract' | 'click' = 'extract';

    constructor() {
        this.extractor = new DataExtractor();
    }

    handleHover(element: HTMLElement, picker: VisualElementPicker): void {
        const containerInfo = findList(element);
        this.applySelection(containerInfo, element, picker);
    }

    private applySelection(containerInfo: ListMatch, element: HTMLElement, picker: VisualElementPicker) {
        this.lastContainerInfo = containerInfo;

        if (containerInfo.isContainer && containerInfo.container) {
            // Find the repeating item unit (the card/row)
            const itemUnit = itemOf(element, containerInfo.container);
            this.lastItemUnit = itemUnit;

            const typeLabel = containerInfo.containerType === 'table' ? 'Table' : 'List';
            const label = `📋 ${typeLabel} Container (${containerInfo.childCount} items)`;
            const sub = `Click to select entire ${typeLabel.toLowerCase()}`;

            picker.updateHighlightManual(
                containerInfo.container,
                label,
                sub,
                element,
                containerInfo.siblings
            );
        } else {
            this.lastItemUnit = null;
            picker.updateHighlightManual(
                element,
                element.tagName.toLowerCase(),
                'Click to select',
                undefined,
                []
            );
        }
    }

    handleClick(element: HTMLElement, picker: VisualElementPicker, report: (selected: ElementSelected) => void): void {
        // Recorded API responses (when the API Finder is recording) can back the list's fields:
        // fetch them first, briefly, so the pick can offer them.
        void refreshNetSources(300).catch(() => undefined).then(() => withAtomCache(() => this.select(element, picker, report)));
    }

    private select(element: HTMLElement, picker: VisualElementPicker, report: (selected: ElementSelected) => void): void {
        const containerInfo = this.lastContainerInfo || findList(element);
        const targetItem = this.lastItemUnit || element;

        let data: any;

        let selector = '';
        let xpath = '';
        let containerSelector = '';
        let containerXPath = '';
        let containerMetadata: any[] = [];
        let itemMetadata: any[] = [];

        if (containerInfo.isContainer && containerInfo.container) {
            const locators = listLocators(containerInfo.container, containerInfo.siblings);
            containerMetadata = locators.container;
            containerSelector = locators.container.find(c => !looksLikeXPath(c.selector))?.selector ?? locators.container[0].selector;
            containerXPath = locators.container.find(c => looksLikeXPath(c.selector))?.selector ?? '';
            const candidates = locators.items;
            selector = candidates.find(c => !looksLikeXPath(c.selector))?.selector ?? candidates[0].selector;

            // [FIX] Re-query container for ALL items using derived selector
            // This ensures preview extraction processes the SAME items as final extraction
            if (selector && containerInfo.container) {
                try {
                    const allMatches = containerInfo.container.querySelectorAll(selector);
                    const allItems = Array.from(allMatches) as HTMLElement[];

                    if (allItems.length > 0) {
                        containerInfo.siblings = allItems;
                        containerInfo.childCount = allItems.length;
                    }
                } catch (e) {
                    // Silently use original filtered siblings if selector fails
                }
            }

            // Infer the list's fields from the same rows the run will read.
            data = this.extractor.extract(targetItem, containerInfo);
            xpath = candidates.find(c => looksLikeXPath(c.selector))?.selector ?? '';

            // Prioritize the best selector in the robust list for the UI
            // This ensures the suggested "attribute extraction selector" matches the visual one
            itemMetadata = candidates;

            report({
                success: true,
                id: `sel-${Date.now()}`,
                data: data,
                containerSelector: containerSelector,
                containerSelectors: containerMetadata,
                containerXPath: containerXPath,
                itemSelector: selector,
                itemSelectors: itemMetadata,
                itemXPath: xpath,
                patternFound: true,
                count: containerInfo.childCount,
                selectionMode: 'list'
            });
        } else {
            data = this.extractor.extract(targetItem, containerInfo);
            const elementResults = elementChain(element);
            selector = elementResults.find(r => !looksLikeXPath(r.selector))?.selector ?? '';
            xpath = elementResults.find(r => looksLikeXPath(r.selector))?.selector ?? '';
            containerSelector = selector;
            containerXPath = xpath;
            containerMetadata = elementResults;
            itemMetadata = elementResults;

            report({
                success: true,
                id: `sel-${Date.now()}`,
                data: data,
                containerSelector: containerSelector,
                containerSelectors: containerMetadata,
                containerXPath: containerXPath,
                itemSelector: selector,
                itemSelectors: itemMetadata,
                itemXPath: xpath,
                patternFound: false,
                count: 1,
                selectionMode: 'list'
            });
        }

        // Click logic removed from selection phase to prevent unintended navigation

        picker.deactivate();
    }
}
