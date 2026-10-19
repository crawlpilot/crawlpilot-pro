import type { ElementSelected } from '../../../../shared/messages';
import { ISelectionStrategy } from './ISelectionStrategy';
import { VisualElementPicker } from '../VisualElementPicker';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { refreshNetSources } from '../../../services/extraction/structuredRows';
import { findList, itemOf, ListMatch } from '../../../services/extraction/items';
import { withAtomCache } from '../../../services/extraction/atoms';
import { listLocators } from '../../../services/selectors/list';
import { elementChain } from '../../../services/selectors/element';
import { resolveContainer, resolveItems } from '../../../../shared/selectors/resolve';

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

        if (containerInfo.isContainer && containerInfo.container) {
            const locators = listLocators(containerInfo.container, containerInfo.siblings);
            const container = locators.container.map(c => c.selector);
            const items = locators.items.map(c => c.selector);

            // The preview reads the rows the run will read: found through the stored chains.
            const root = resolveContainer(container, items).result ?? containerInfo.container;
            const rows = resolveItems(items, root).result as HTMLElement[];
            if (rows.length > 0) {
                containerInfo.siblings = rows;
                containerInfo.childCount = rows.length;
            }
            const data = this.extractor.extract(targetItem, containerInfo);

            report({
                success: true,
                id: `sel-${Date.now()}`,
                data,
                container,
                items,
                patternFound: true,
                count: containerInfo.childCount,
                selectionMode: 'list'
            });
        } else {
            // A single element: read like one item; it is its own container.
            const data = this.extractor.extract(targetItem, containerInfo);
            report({
                success: true,
                id: `sel-${Date.now()}`,
                data,
                container: elementChain(element).map(c => c.selector),
                items: [],
                patternFound: false,
                count: 1,
                selectionMode: 'list'
            });
        }

        // Click logic removed from selection phase to prevent unintended navigation

        picker.deactivate();
    }
}
