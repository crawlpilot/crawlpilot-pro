import { SelectorState } from '../types/extraction';
import { ExtractionResult, Column } from '../types/database';

/**
 * Consolidates data from multiple selectors into a single extraction result.
 * Merges items and deduplicates columns.
 */
export function consolidateSelectors(selectors: SelectorState[], currentTabUrl?: string): ExtractionResult {
    const allItems: any[] = [];
    const allColumns: Column[] = [];
    const columnIds = new Set<string>();
    let sourceUrl = "";

    // Iterate through all selectors and merge their data
    selectors.forEach((sel) => {
        const data = sel.data;
        if (!data) return;

        // Capture source URL from the first selector that has it
        if (!sourceUrl && (data.sourceUrl || data.source_url)) {
            sourceUrl = data.sourceUrl || data.source_url;
        }

        // Merge Items
        if (data.items && Array.isArray(data.items)) {
            allItems.push(...data.items);
        }

        // Merge Columns (Deduplicated by ID)
        if (data.columns && Array.isArray(data.columns)) {
            data.columns.forEach((col: Column) => {
                // Ensure column has an ID (fallback to name if needed, though ID should exist)
                const colId = col.id || col.name;
                if (colId && !columnIds.has(colId.toString())) {
                    columnIds.add(colId.toString());
                    allColumns.push(col);
                }
            });
        }
    });

    // Callers set `timestamp` on the result themselves where needed.
    return {
        type: 'list',
        columns: allColumns,
        items: allItems,
        source_url: sourceUrl || currentTabUrl || 'unknown',
        count: allItems.length,
    };
}
