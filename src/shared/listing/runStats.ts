/**
 * Per-page accounting for listing runs (pagination, load-more, infinite scroll): rows kept, rows that
 * repeat an earlier page (sponsored slots, pages that overlap), and why the run stopped. Modelled on
 * thenos's ListingResult (pages, stop_reason) so "why did run #12 get 40 rows?" has an answer.
 */
import { hashString } from '../utils/hash';

export interface PageStat {
    page: number;
    rows: number;
    duplicates: number;
}

export type StopReason =
    | 'no_more_pagination_buttons' | 'no_navigation' | 'url_loop_detected' | 'content_unchanged'
    | 'no_new_content' | 'max_pages_reached' | 'cancelled' | 'unable_to_click' | 'container_lost'
    | 'page_blocked' | 'error' | string;

export const STOP_REASON_LABELS: Record<string, string> = {
    no_more_pagination_buttons: 'No more "Next" button',
    no_navigation: 'Clicking "Next" did not change the page',
    url_loop_detected: 'Returned to a page already visited',
    content_unchanged: 'Next page showed the same items',
    no_new_content: 'No new items on the last pages',
    max_pages_reached: 'Reached the page limit',
    cancelled: 'Stopped by you',
    unable_to_click: 'Could not click "Next"',
    container_lost: 'List not found on the next page',
    page_blocked: 'Site blocked the next page',
    error: 'Error',
};

export function stopReasonLabel(reason: string | undefined): string {
    if (!reason) return '';
    return STOP_REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');
}

/** Identity of a row for de-duplication: a chosen column when given, else the whole row's content. */
export function rowKey(row: Record<string, any>, keyColumn?: string): string {
    if (keyColumn && row[keyColumn] != null && row[keyColumn] !== '') return `k:${String(row[keyColumn])}`;
    const entries = Object.keys(row)
        .filter(k => !k.startsWith('_'))
        .sort()
        .map(k => [k, row[k]]);
    return `h:${hashString(JSON.stringify(entries))}`;
}

export class ListingRunTracker {
    private seen = new Set<string>();
    private pages = new Map<number, PageStat>();
    duplicates = 0;

    constructor(private keyColumn?: string) {}

    /** Records a batch of rows for a page and returns only the ones not seen before. */
    add(page: number, rows: Record<string, any>[]): Record<string, any>[] {
        const stat = this.pages.get(page) ?? { page, rows: 0, duplicates: 0 };
        const kept: Record<string, any>[] = [];
        for (const row of rows) {
            const key = rowKey(row, this.keyColumn);
            if (this.seen.has(key)) {
                stat.duplicates++;
                this.duplicates++;
                continue;
            }
            this.seen.add(key);
            stat.rows++;
            kept.push(row);
        }
        this.pages.set(page, stat);
        return kept;
    }

    get pageStats(): PageStat[] {
        return Array.from(this.pages.values()).sort((a, b) => a.page - b.page);
    }
}

/** Share of rows each column filled, most-filled first (thenos `ListingResult.coverage`). */
export function columnCoverage(columns: { id: string; name: string }[], items: Record<string, unknown>[]): { name: string; fill: number }[] {
    if (items.length === 0) return [];
    return columns
        .filter(c => c.id !== 'recordId')
        .map(c => ({
            name: c.name,
            fill: items.filter(i => i[c.id] !== undefined && i[c.id] !== null && i[c.id] !== '').length / items.length,
        }))
        .sort((a, b) => b.fill - a.fill);
}
