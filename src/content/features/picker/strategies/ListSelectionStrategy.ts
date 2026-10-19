import type { ElementSelected } from '../../../../shared/messages';
import { ISelectionStrategy, type Reading } from './ISelectionStrategy';
import { VisualElementPicker } from '../VisualElementPicker';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { refreshNetSources } from '../../../services/extraction/structuredRows';
import { findList, findListCandidates, itemOf, ListMatch } from '../../../services/extraction/items';
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
    /** ↑ / ↓ step through the sections around the hovered card (plan L5), not single elements. */
    public stepsThroughReadings = true;

    constructor() {
        this.extractor = new DataExtractor();
    }

    /**
     * The sections around the hovered element, nearest first (only its ancestors and their children:
     * `picker-container-bound-plan.md`), the one `findList` picks suggested. A grid made of rows of
     * cards is offered as its rows too.
     */
    readings(element: HTMLElement): Reading[] {
        const { lists, suggested } = findListCandidates(element);
        return lists.flatMap((m, group): Reading[] => {
            const container = m.container!;
            const cards: Reading = { kind: 'list', label: sectionLabel(container, m.siblings).label, outline: container, outlines: m.siblings, group, suggested: group === suggested, data: m };
            if (!m.rows) return [cards];
            const rows = m.rows.siblings.length;
            return [cards, { kind: 'list', label: `${sectionLabel(container, m.rows.siblings).label.replace(/ · .*$/, '')} · ${rows} row${rows === 1 ? '' : 's'}`, outline: container, outlines: m.rows.siblings, group, variant: 'rows', data: m.rows }];
        });
    }

    handleHover(element: HTMLElement, picker: VisualElementPicker, reading?: Reading): void {
        const found = (reading?.data as ListMatch | undefined) ?? findList(element);
        this.lastMatch = found;
        if (found.isContainer && found.container) {
            this.lastItemUnit = found.siblings.find(s => s.contains(element)) ?? itemOf(element, found.container);
            const label = reading?.label ?? sectionLabel(found.container, found.siblings).label;
            picker.updateHighlightManual(found.container, `📋 ${label}`, 'Click to select the list · ↑↓ other sections', element, found.siblings);
        } else {
            this.lastItemUnit = null;
            picker.updateHighlightManual(element, element.tagName.toLowerCase(), 'Click to select', undefined, []);
        }
    }

    handleClick(element: HTMLElement, picker: VisualElementPicker, report: (selected: ElementSelected) => void, reading?: Reading): void {
        // The section shown is the one saved.
        if (reading?.data) {
            const shown = reading.data as ListMatch;
            this.lastMatch = shown;
            this.lastItemUnit = shown.siblings.find(s => s.contains(element)) ?? (shown.container ? itemOf(element, shown.container) : null);
        }
        const found = this.lastMatch;
        const busyText = found?.isContainer ? `Reading ${found.siblings.length} items…` : 'Reading…';
        // Recorded API responses (when the API Finder is recording) can back the list's fields:
        // fetch them first, briefly, so the pick can offer them.
        void picker.showBusy(busyText)
            .then(() => refreshNetSources(300).catch(() => undefined))
            .then(() => withAtomCache(() => this.select(element, picker, report)))
            .catch(err => { console.error('[Picker] Reading the pick failed:', err); picker.clearBusy(); });
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
