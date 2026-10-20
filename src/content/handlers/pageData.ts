/** Background runs: a Page Extractor recipe's record, or a page's metadata, from this tab. */
import { extractPage } from '../services/page/extractPage';
import { extractMetadata } from '../services/metadata/MetadataExtractionService';
import { fail, ok, on } from '../../shared/messages';
import { summarizePage } from '../services/pageSummary';
import { findNextControl } from '../services/pagination/findNext';
import { BULK_BUDGET, revealForReading, revealSummary } from '../services/reveal';
import { quiet, sleep } from '../utils/clock';

/** Resolves once nodes have stopped being added or removed for `stableMs` (SPA hydration, API data), or after `timeoutMs`. */
function waitForDomStability(stableMs = 1500, timeoutMs = 12000): Promise<void> {
    return quiet(document.body, stableMs, timeoutMs, { attributes: false });
}

/** Scrolls down up to 12 viewports so lazy loaders fire, then back to the top. */
async function scrollToRevealLazyContent(): Promise<void> {
    const viewportHeight = window.innerHeight || 800;
    for (let step = 1; step <= 12; step++) {
        const y = step * viewportHeight;
        if (y >= Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)) break;
        window.scrollTo({ top: y, behavior: 'instant' });
        window.dispatchEvent(new Event('scroll'));
        await sleep(600);
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(800);
}

export function registerPageDataHandlers() {
    on('PAGE_SUMMARY', () => ok({ summary: summarizePage() }));
    on('FIND_NEXT', () => ok({ control: findNextControl() }));

    on('CMD_EXTRACT_PAGE_BACKGROUND', async ({ url, elements, config }) => {
        const record = await extractPage(elements || [], config || {});
        return ok({ result: { ...record, url } });
    });

    on('CMD_EXTRACT_METADATA', async ({ options }) => {
        try {
            await waitForDomStability();
            await scrollToRevealLazyContent();
            // Closed sections, inactive tabs and "Show more" text are read too (a tighter budget: every
            // page of a bulk run pays it), then the page is put back.
            const revealed = await revealForReading(options?.reveal ?? 'read', BULK_BUDGET);
            try {
                const result = extractMetadata(options || {}, revealed.markdownOptions);
                return ok({ result: { ...result, revealed: revealSummary(revealed.report) } });
            } finally {
                await revealed.restore();
            }
        } catch (err: any) {
            return fail(err, 'Metadata extraction failed');
        }
    });
}
