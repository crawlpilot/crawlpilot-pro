/** Page Extractor bulk runs: the recipe's steps (clicks and extracts, in order) on every URL. */
import type { BulkStart } from '../../shared/messages';
import type { RunJob } from './JobRunner';
import { pageSpec } from '../../shared/recipes/spec';

export function bulkJob(start: BulkStart): RunJob {
    const { elements, config } = start;
    if (elements.length === 0) throw new Error('No elements to extract');

    const clicks = elements.filter(e => e.action === 'click');
    const extracts = elements.filter(e => e.action !== 'click');
    const actionSpeed = config.actionSpeed || 500;
    const clickWaitMs = config.clickWaitMs ?? Math.max(actionSpeed, 2000);

    return {
        kind: 'bulk',
        urls: start.urls,
        maxConcurrent: start.maxConcurrent,
        settings: config,
        // Clicks need a focusable window so animations run at full speed.
        interactive: clicks.length > 0,
        jobId: start.jobId,
        name: start.customName,
        spec: pageSpec(elements, config),
        tableType: 'bulk-page',
        columns: found => [
            { id: 'source_url', name: 'Source URL', type: 'url' },
            ...found.filter(c => c.id !== 'source_url' && c.id !== 'recordId'),
            { id: 'recordId', name: 'Record ID', type: 'text' },
        ],

        async extract(tabId, url, ctx) {
            if (extracts.length === 0 || ctx.stopped()) return null;
            // The whole recipe, in its order: each click is checked for an effect and what it reveals
            // is waited for in the page (`extractPage`), not with fixed delays here.
            const response = await ctx.message(tabId, 'CMD_EXTRACT_PAGE_BACKGROUND', {
                url,
                elements,
                config: { ...config, actionSpeed, ...(clicks.length > 0 ? { clickWaitMs } : {}) },
            });
            if (!response.success) throw new Error(response.error);
            const { item, items, columns } = response.result;
            const rows = Array.isArray(items) ? items : item ? [item] : [];
            return { rows, columns };
        },
    };
}
