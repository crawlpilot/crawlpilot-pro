import type { ElementSelected } from '../../../../shared/messages';
import { ISelectionStrategy } from './ISelectionStrategy';
import { VisualElementPicker } from '../VisualElementPicker';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { refreshNetSources } from '../../../services/extraction/structuredRows';
import { findList, itemOf, ListMatch } from '../../../services/extraction/items';
import { sectionLabel } from '../../../services/extraction/section';
import { withAtomCache } from '../../../services/extraction/atoms';
import { listLocators } from '../../../services/selectors/list';
import { collectAtoms } from '../../../services/extraction/atoms';
import { rowFitsGate } from '../../../services/extraction/fields/gate';
import type { ReaderColumn } from '../../../services/extraction/fields';
import { elementChain } from '../../../services/selectors/element';
import { resolveContainer, resolveItems } from '../../../../shared/selectors/resolve';

/** The list's items among the rows the chains find: the ones the fields' gate keeps, and placeholders still loading. */
function itemCount(rows: HTMLElement[], columns: ReaderColumn[]): number {
    const gate = columns.find(c => c.reader?.rowGate)?.reader?.rowGate;
    return withAtomCache(() => rows.filter(r => !gate || collectAtoms(r).length === 0 || rowFitsGate(r, gate)).length);
}

/**
 * The List Extractor's picker: the section under the cursor (`docs/plans/picker-container-bound-plan.md`).
 * Hover highlights the nearest container of cards around the element, with a dashed outline on each
 * card; a click picks it. Another section (a sponsored shelf, a second carousel) is picked as another list.
 */
export class ListSelectionStrategy implements ISelectionStrategy {
    private extractor: DataExtractor;
    private lastMatch: ListMatch | null = null;
    private lastItemUnit: HTMLElement | null = null;
    public preferredAction?: 'extract' | 'click' = 'extract';

    constructor() {
        this.extractor = new DataExtractor();
    }

    handleHover(element: HTMLElement, picker: VisualElementPicker): void {
        const found = findList(element);
        this.lastMatch = found;
        if (found.isContainer && found.container) {
            this.lastItemUnit = found.siblings.find(s => s.contains(element)) ?? itemOf(element, found.container);
            picker.updateHighlightManual(found.container, `📋 ${sectionLabel(found.container, found.siblings).label}`, 'Click to select the list', element, found.siblings);
        } else {
            this.lastItemUnit = null;
            picker.updateHighlightManual(element, element.tagName.toLowerCase(), 'Click to select', undefined, []);
        }
    }

    handleClick(element: HTMLElement, picker: VisualElementPicker, report: (selected: ElementSelected) => void): void {
        // Recorded API responses (when the API Finder is recording) can back the list's fields:
        // fetch them first, briefly, so the pick can offer them.
        void refreshNetSources(300).catch(() => undefined).then(() => withAtomCache(() => this.select(element, picker, report)));
    }

    private select(element: HTMLElement, picker: VisualElementPicker, report: (selected: ElementSelected) => void): void {
        const found = this.lastMatch ?? findList(element);
        const targetItem = this.lastItemUnit || element;

        if (found.isContainer && found.container) {
            const locators = listLocators(found.container, found.siblings, true);
            const container = locators.container.map(c => c.selector);
            const items = locators.items.map(c => c.selector);

            // The fields are learned from the cards the picker chose (all of them items); the preview
            // then reads the rows the run will read, found through the stored chains, with them.
            const data = this.extractor.extract(targetItem, found, { decided: true });
            const root = resolveContainer(container, items).result ?? found.container;
            const rows = resolveItems(items, root).result as HTMLElement[];
            if (rows.length > 0) {
                const read = this.extractor.extractRows(rows, data.columns);
                Object.assign(data, { items: read.items, count: read.items.length });
            }
            const count = rows.length > 0 ? itemCount(rows, data.columns) : found.childCount;
            // Labelled with what was picked: the rows its selectors find.
            const { label, kind } = sectionLabel(found.container, found.siblings, count);

            report({
                success: true,
                id: `sel-${Date.now()}`,
                data,
                container,
                items,
                patternFound: true,
                count,
                label,
                kind,
                selectionMode: 'list',
            });
        } else {
            // A single element: read like one item; it is its own container.
            const data = this.extractor.extract(targetItem, found);
            report({
                success: true,
                id: `sel-${Date.now()}`,
                data,
                container: elementChain(element).map(c => c.selector),
                items: [],
                patternFound: false,
                count: 1,
                selectionMode: 'list',
            });
        }

        picker.deactivate();
    }
}
