/** Page Extractor bulk runs: the recipe's steps (clicks and extracts, in order) on every URL. */
import type { BulkStart } from '../../shared/messages';
import type { RunJob } from './JobRunner';
import { pageSpec } from '../../shared/recipes/spec';
import type { PageSpec } from '../../shared/types/database';
import type { StepResult } from '../../shared/listing/stepStats';
import { db } from '../../shared/db';

/**
 * The details run joins its list's recipe: a rerun of the list then reads each item's page too, with
 * the same fields, and joins them again (a new revision of the list's recipe).
 */
async function keepDetailsWithList(listTableId: number, page: PageSpec, urlColumn: string): Promise<void> {
    const list = await db.tables.get(listTableId);
    const listJob = list?.jobId !== undefined ? await db.jobs.get(list.jobId) : null;
    const recipe = listJob ? await db.jobs.getRecipe(listJob.recipeId) : null;
    if (recipe?.id === undefined || recipe.spec.kind !== 'list') return;
    await db.jobs.reviseRecipe(recipe.id, { ...recipe.spec, details: { page, urlColumn } });
}

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
        // A click with no effect in a hidden tab is tried again in a parked window.
        interactive: clicks.length > 0,
        jobId: start.jobId,
        name: start.customName,
        spec: pageSpec(elements, config),
        tableType: 'bulk-page',
        // A list's details: the fields join onto the list's rows, so the list holds what each item's page says.
        ...(start.joinInto ? { afterSave: async (tableId: number) => {
            const { tableId: listId, urlColumn } = start.joinInto!;
            await db.tables.joinDetailsInto(listId, urlColumn, tableId);
            await keepDetailsWithList(listId, pageSpec(elements, config), urlColumn);
        } } : {}),
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
                config: {
                    ...config, actionSpeed, ...(clicks.length > 0 ? { clickWaitMs } : {}),
                    // The site's page wait: fields are waited for that long.
                    ...(ctx.settings.elementTimeout ? { waitForElements: true, elementTimeout: ctx.settings.elementTimeout } : {}),
                },
            });
            if (!response.success) throw new Error(response.error);
            const { item, items, columns, steps } = response.result as typeof response.result & { steps?: StepResult[] };
            const rows = Array.isArray(items) ? items : item ? [item] : [];
            const needsWindow = (steps ?? []).some(s => s.action === 'click' && s.status === 'no-effect');
            return { rows, columns, needsWindow, steps };
        },
    };
}
