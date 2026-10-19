/** Background runs: a Page Extractor recipe's record, or a page's metadata, from this tab. */
import { extractPage } from '../services/page/extractPage';
import { extractMetadata } from '../services/metadata/MetadataExtractionService';
import { fail, ok, on } from '../../shared/messages';
import { summarizePage } from '../services/pageSummary';
import { findNextControl } from '../services/pagination/findNext';
import { BULK_BUDGET, revealForReading, revealSummary } from '../services/reveal';

/** Resolves once the DOM has been quiet for `stableMs` (SPA hydration, API data), or after `timeoutMs`. */
function waitForDomStability(stableMs = 1500, timeoutMs = 12000): Promise<void> {
    return new Promise(resolve => {
        let stableTimer: ReturnType<typeof setTimeout>;
        const finish = () => {
            observer.disconnect();
            clearTimeout(deadline);
            clearTimeout(stableTimer);
            resolve();
        };
        const deadline = setTimeout(finish, timeoutMs);
        const reset = () => {
            clearTimeout(stableTimer);
            stableTimer = setTimeout(finish, stableMs);
        };
        const observer = new MutationObserver(reset);
        observer.observe(document.body, { childList: true, subtree: true });
        reset();
    });
}

/** Scrolls down up to 12 viewports so lazy loaders fire, then back to the top. */
async function scrollToRevealLazyContent(): Promise<void> {
    const viewportHeight = window.innerHeight || 800;
    for (let step = 1; step <= 12; step++) {
        const y = step * viewportHeight;
        if (y >= Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)) break;
        window.scrollTo({ top: y, behavior: 'instant' });
        window.dispatchEvent(new Event('scroll'));
        await new Promise(r => setTimeout(r, 600)); // clamped to ~1000ms in inactive background tabs
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise(r => setTimeout(r, 800));
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
