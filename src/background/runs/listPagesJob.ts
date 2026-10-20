/**
 * A list over numbered pages by their addresses (`listing/urlPages.ts`): each page opened in a
 * background tab and its list read with the pick's chains and fields (`READ_LIST_PAGE`). Runs on the
 * bulk runner, so pages are paced, checked (bot walls, login walls, soft 404s) and read several at once,
 * and the side panel follows it as a bulk run.
 */
import type { ListPagesStart } from '../../shared/messages';
import type { Column } from '../../shared/types/database';
import type { RunJob } from './JobRunner';

export function listPagesJob(start: ListPagesStart): RunJob {
    if (start.urls.length === 0) throw new Error('No pages to read');
    /** The first page with no list: the listing ends there, and later pages are not read. */
    let end = Infinity;
    return {
        kind: 'bulk',
        urls: start.urls,
        maxConcurrent: start.maxConcurrent,
        settings: { requestDelay: 500 },
        jobId: undefined,
        name: start.customName,
        spec: start.spec,
        tableType: 'list',
        // Pages after the first one with no list are past the listing's end.
        skip: url => start.urls.indexOf(url) > end,
        unitFailed: url => { end = Math.min(end, start.urls.indexOf(url)); },
        columns: found => [...found.filter(c => c.id !== 'source_url'), { id: 'source_url', name: 'Page', type: 'url' }],

        async extract(tabId, url, ctx) {
            const index = start.urls.indexOf(url);
            if (ctx.stopped() || index > end) return null;
            const response = await ctx.message(tabId, 'READ_LIST_PAGE', { container: start.container, items: start.items, columns: start.columns });
            // A page that doesn't load is past the end too (most sites answer a page number past the last with an error).
            if (!response.success) { end = Math.min(end, index); throw new Error(response.error); }
            const { rows, columns } = response;
            // A page whose list is gone (past the last page, a page that didn't render it) has no rows.
            if (rows.length === 0) { end = Math.min(end, index); return null; }
            return { rows, columns: columns as Column[] };
        },
    };
}
