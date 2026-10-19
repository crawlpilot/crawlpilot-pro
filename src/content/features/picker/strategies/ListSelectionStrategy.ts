import type { ElementSelected, ListAlternative } from '../../../../shared/messages';
import { ISelectionStrategy } from './ISelectionStrategy';
import { VisualElementPicker } from '../VisualElementPicker';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { refreshNetSources } from '../../../services/extraction/structuredRows';
import { findList, itemOf, ListMatch } from '../../../services/extraction/items';
import { expandItemSet, type ItemGroup, type ItemSet } from '../../../services/extraction/itemSets';
import { withAtomCache } from '../../../services/extraction/atoms';
import { listLocators } from '../../../services/selectors/list';
import { elementChain } from '../../../services/selectors/element';
import { resolveContainer, resolveItems } from '../../../../shared/selectors/resolve';

const KIND_LABEL: Record<ItemGroup['kind'], string> = { results: 'Results', sponsored: 'Sponsored', carousel: 'Carousel' };

/** "Results · 18 items", "Sponsored · 3 items", "Customers also viewed · 6 items". */
export function groupLabel(group: ItemGroup): string {
    const name = group.kind === 'results' ? (group.heading || KIND_LABEL.results) : KIND_LABEL[group.kind];
    return `${name} · ${group.items.length} item${group.items.length === 1 ? '' : 's'}`;
}

/** The pick's data, read from a list's stored chains the way a run reads them. */
export function readListFromChains(container: string[], items: string[], extractor = new DataExtractor()): { data: any; count: number } | null {
    return withAtomCache(() => {
        const root = resolveContainer(container, items).result;
        if (!root) return null;
        const rows = resolveItems(items, root).result as HTMLElement[];
        if (rows.length === 0) return null;
        const match: ListMatch = { isContainer: true, container: root, siblings: rows, childCount: rows.length };
        return { data: extractor.extract(rows[0], match), count: rows.length };
    });
}

export class ListSelectionStrategy implements ISelectionStrategy {
    private extractor: DataExtractor;
    private lastSet: ItemSet | null = null;
    private lastFound: HTMLElement | null = null;
    private lastItemUnit: HTMLElement | null = null;
    public preferredAction?: 'extract' | 'click' = 'extract';

    constructor() {
        this.extractor = new DataExtractor();
    }

    /** The item set around `element`; recomputed only when hovering moves to another list. */
    private itemSet(element: HTMLElement): ItemSet {
        const found = findList(element);
        if (this.lastSet && found.container && found.container === this.lastFound && this.lastSet.siblings.some(s => s.contains(element) || element.contains(s))) return this.lastSet;
        this.lastFound = found.container;
        return expandItemSet(found, element);
    }

    handleHover(element: HTMLElement, picker: VisualElementPicker): void {
        this.applySelection(this.itemSet(element), element, picker);
    }

    private applySelection(set: ItemSet, element: HTMLElement, picker: VisualElementPicker) {
        this.lastSet = set;

        if (set.isContainer && set.container) {
            this.lastItemUnit = set.siblings.find(s => s.contains(element)) ?? itemOf(element, set.container);
            const group = set.groups[set.chosen];
            const label = group ? `📋 ${groupLabel(group)}` : `📋 List (${set.childCount} items)`;
            const sub = set.chosen !== set.clicked && set.groups[set.clicked]
                ? `Click to use the ${set.groups[set.chosen].kind === 'results' ? 'results' : 'list'}; ${groupLabel(set.groups[set.clicked]).toLowerCase()} is offered too`
                : 'Click to select the list';
            picker.updateHighlightManual(set.container, label, sub, element, set.siblings);
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
        const set = this.lastSet ?? this.itemSet(element);
        const targetItem = this.lastItemUnit || element;

        if (set.isContainer && set.container) {
            const locators = listLocators(set.container, set.siblings);
            const container = locators.container.map(c => c.selector);
            const items = locators.items.map(c => c.selector);

            // The preview reads the rows the run will read: found through the stored chains.
            const root = resolveContainer(container, items).result ?? set.container;
            const rows = resolveItems(items, root).result as HTMLElement[];
            const match: ListMatch = rows.length > 0 ? { ...set, siblings: rows, childCount: rows.length } : set;
            const data = this.extractor.extract(targetItem, match);

            // The page's other lists of the same items (a sponsored shelf, a carousel): one click away.
            const alternatives: ListAlternative[] = set.groups
                .map((g, i) => [g, i] as const)
                .filter(([g, i]) => i !== set.chosen && g.items.length >= 2)
                .map(([g]) => {
                    const alt = listLocators(g.container, g.items);
                    return { label: groupLabel(g), kind: g.kind, count: g.items.length, container: alt.container.map(c => c.selector), items: alt.items.map(c => c.selector) };
                });

            report({
                success: true,
                id: `sel-${Date.now()}`,
                data,
                container,
                items,
                patternFound: true,
                count: match.childCount,
                label: set.groups[set.chosen] ? groupLabel(set.groups[set.chosen]) : undefined,
                kind: set.groups[set.chosen]?.kind,
                alternatives,
                selectionMode: 'list',
            });
        } else {
            // A single element: read like one item; it is its own container.
            const data = this.extractor.extract(targetItem, set);
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
