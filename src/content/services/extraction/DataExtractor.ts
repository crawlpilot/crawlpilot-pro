import type { ListMatch } from './items';
import { withAtomCache } from './atoms';
import { hashString } from '../../../shared/utils/hash';
import { inferFields, readRow, hasReaders, structuredColumns, ReaderColumn } from './fields';
import { findStructuredSource } from './structuredRows';
import { pickProblems } from './pickCheck';
import { backfill } from './fields/backfill';

export interface RowsResult {
    columns: ReaderColumn[];
    items: Record<string, string>[];
    duplicates: number;
    /** Field checks for the review step. */
    problems: string[];
}

/**
 * Extracts structured data from DOM elements, field-first: a list's fields are inferred once from
 * its rows (`fields/`) and every row is read with them, so every row has the same columns.
 */
export class DataExtractor {
    /** `decided`: the rows are the cards the picker chose, all items (`fields/gate.ts`). */
    public extract(element: HTMLElement, containerInfo: ListMatch, opts: { decided?: boolean } = {}) {
        if (containerInfo.isContainer) {
            return this.extractList(containerInfo, !!opts.decided);
        } else {
            return this.extractSingle(element);
        }
    }

    private extractList({ siblings }: ListMatch, decided: boolean) {
        const first = this.extractRows(siblings, undefined, decided);
        const structured = this.structuredAlternative(siblings);
        // The page's data backs up the fields that mean the same (a price block that never rendered).
        const backed = structured ? withAtomCache(() => backfill(first.columns, structured.columns, siblings)) : first.columns;
        const { columns, items, duplicates, problems } = backed === first.columns || backed.every((c, i) => c === first.columns[i])
            ? first
            : { ...this.extractRows(siblings, backed), problems: first.problems };

        return {
            type: 'list',
            columns: columns,
            items: items,
            source_url: window.location.href,
            count: items.length,
            timestamp: new Date().toISOString(),
            metadata: {
                duplicatesRemoved: duplicates,
                uniqueItems: items.length,
                fieldProblems: [...pickProblems(siblings.length), ...problems]
            },
            ...(structured ? { structured } : {})
        };
    }

    /**
     * The same rows read from the page's own JSON (JSON-LD, embedded state) when an array there lines
     * up with them: named fields, no guessing. Offered next to the DOM fields; the user picks one.
     */
    private structuredAlternative(rows: Element[]) {
        try {
            const source = findStructuredSource(rows);
            if (!source) return undefined;
            const columns = structuredColumns(source);
            const { items } = this.extractRows(rows, columns);
            if (items.length < Math.max(2, rows.length * 0.5)) return undefined;
            return { label: source.label, matched: source.matched, sampled: source.sampled, columns, items };
        } catch {
            return undefined;
        }
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
    public extractRows(rowEls: Element[], columns?: unknown, decided = false): RowsResult {
        // Inference and the reads scan the same rows: share one scan of each.
        return withAtomCache(() => this.extractRowsCached(rowEls, columns, decided));
    }

    private extractRowsCached(rowEls: Element[], columns: unknown, decided: boolean): RowsResult {
        let cols: ReaderColumn[];
        let problems: string[] = [];
        if (hasReaders(columns)) {
            cols = columns;
        } else {
            const inferred = inferFields(rowEls, { decided });
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
