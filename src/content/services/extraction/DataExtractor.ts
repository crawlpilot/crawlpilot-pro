import { hashString } from '../../../shared/utils/hash';
import { inferFields, readRow, hasReaders, ReaderColumn } from './fieldSchema';

export interface RowsResult {
    columns: ReaderColumn[];
    items: Record<string, string>[];
    duplicates: number;
    /** Field checks for the review step. */
    problems: string[];
}

/**
 * Extracts structured data from DOM elements, field-first: a list's fields are inferred once from
 * its rows (`fieldSchema.ts`) and every row is read with them, so every row has the same columns.
 */
export class DataExtractor {
    public extract(element: HTMLElement, containerInfo: any) {
        if (containerInfo.isContainer) {
            return this.extractList(containerInfo);
        } else {
            return this.extractSingle(element);
        }
    }

    private extractList(containerInfo: any) {
        const { siblings, confidence } = containerInfo;
        const { columns, items, duplicates, problems } = this.extractRows(siblings);

        return {
            type: 'list',
            columns: columns,
            items: items,
            source_url: window.location.href,
            count: items.length,
            timestamp: new Date().toISOString(),
            metadata: {
                containerConfidence: confidence || 0,
                duplicatesRemoved: duplicates,
                uniqueItems: items.length,
                fieldProblems: problems
            }
        };
    }

    private extractSingle(element: HTMLElement) {
        // Smart extraction for single elements (e.g. buyboxes): read every field under the element,
        // just like one row of a list.
        const { columns, items } = this.extractRows([element]);

        return {
            type: 'list', // [CRITICAL] Fake it as a 'list' so PageExtractionStrategy explodes the columns
            columns: columns,
            items: items,
            source_url: window.location.href,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Reads rows with `columns` when they carry readers (a saved recipe, an earlier page), otherwise
     * infers the fields once from these rows first.
     */
    public extractRows(rowEls: Element[], columns?: unknown): RowsResult {
        let cols: ReaderColumn[];
        let problems: string[] = [];
        if (hasReaders(columns)) {
            cols = columns;
        } else {
            const inferred = inferFields(rowEls);
            cols = inferred.columns;
            problems = inferred.problems;
        }

        const items: Record<string, string>[] = [];
        const seen = new Set<string>();
        let duplicates = 0;
        for (const el of rowEls) {
            const row = readRow(el, cols);
            if (Object.keys(row).length === 0) continue;
            const hash = hashString(JSON.stringify(row)).toString();
            if (seen.has(hash)) { duplicates++; continue; }
            seen.add(hash);
            items.push(row);
        }
        return { columns: cols, items, duplicates, problems };
    }
}
