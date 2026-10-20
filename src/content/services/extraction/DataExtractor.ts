import type { ListMatch } from './items';
import { withAtomCache } from './atoms';
import { hashString } from '../../../shared/utils/hash';
import { inferFields, readRow, hasReaders, structuredColumns, ReaderColumn } from './fields';
import { findStructuredSource } from './structuredRows';
import { pickProblems } from './pickCheck';
import { backfill } from './fields/backfill';

/** Fewer DOM fields than this: the markup says little about each card (a photo grid: its link). */
const SPARSE_FIELDS = 3;
/** Page-data fields added to a sparse pick, at most. */
const MAX_JOINED = 8;
/** Keys that hold an ID (`pk`, `id`, `user.id`, `media_id`) or a page cursor: the link has said which item it is. */
const ID_KEY = /(^|[._])(id|pk|cursor|[a-z]+_id|[a-z]+Id)$/;

/**
 * The page's data joined to fields the markup shows (docs/plans/virtual-feeds-plan.md §3.3): its
 * fields that aren't IDs and don't repeat a DOM field's values, renamed where an ID is taken.
 */
function joinFields(dom: ReaderColumn[], domItems: Record<string, string>[], data: ReaderColumn[], dataItems: Record<string, string>[]): ReaderColumn[] {
    const domValues = dom.map(c => new Set(domItems.map(r => r[c.id]).filter(Boolean)));
    const ids = new Set(dom.map(c => c.id));
    const extra: ReaderColumn[] = [];
    for (const c of data) {
        const key = c.reader?.json?.key ?? '';
        if (!key || key === c.reader?.json?.anchor || ID_KEY.test(key)) continue;
        const values = dataItems.map(r => r[c.id]).filter(Boolean);
        if (values.length === 0) continue;
        // The same values as a DOM field (an image URL, a title): already there.
        if (domValues.some(set => values.filter(v => set.has(v)).length >= values.length * 0.8)) continue;
        let id = c.id;
        while (ids.has(id)) id = `${id}_data`;
        ids.add(id);
        extra.push({ ...c, id, order: dom.length + extra.length });
        if (extra.length >= MAX_JOINED) break;
    }
    return [...dom, ...extra];
}

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
        let backed = structured ? withAtomCache(() => backfill(first.columns, structured.columns, siblings)) : first.columns;
        // Cards the markup says little about (a photo grid): the page's data adds what it holds about each.
        if (structured && backed.length < SPARSE_FIELDS) {
            backed = joinFields(backed, first.items, structured.columns, structured.items);
        }
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
