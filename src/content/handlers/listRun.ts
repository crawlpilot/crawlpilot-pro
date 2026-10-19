/** List Extractor runs on this page: auto-scroll and next-button pagination, read with the list's frozen fields. */
import { AutoScrollAction } from '../features/autoscroll/AutoScrollAction';
import { settle } from '../utils/settle';
import { PaginationAction } from '../features/pagination/PaginationAction';
import { refreshNetSourcesFor } from '../services/extraction/structuredRows';
import { checkPage, hasReaders, inferFields, readWhenReady, similarSiblings, ReaderColumn } from '../services/extraction/fields';
import { HL_COLOR, HL_GLOW } from '../utils/highlight-tokens';
import { looksLikeXPath, resolveContainer, resolveItems } from '../../shared/selectors/resolve';
import { hashString } from '../../shared/utils/hash';
import { AutoScrollRequest, fail, ok, on, PaginationRequest, send } from '../../shared/messages';
import { storage } from '../../shared/storage';

const UPDATE_INTERVAL_MS = 500;
const UPDATE_BATCH_SIZE = 10;

let scrollAbort: AbortController | null = null;
let paginationAbort: AbortController | null = null;
/** The list's frozen fields for the running auto-scroll (from the preview, or inferred once). */
let scrollColumns: ReaderColumn[] | null = null;
let sentPaginationColumns: unknown = null;
let pendingUpdates = 0;
let rowTotal = 0;
let updateTimer: ReturnType<typeof setTimeout> | null = null;

function injectHighlightStyle() {
    const style = document.createElement('style');
    style.textContent = `
        .crawlpilot-highlight {
            outline: 2px solid ${HL_COLOR} !important;
            outline-offset: -2px !important;
            box-shadow: 0 0 8px ${HL_GLOW}, inset 0 0 16px rgba(34, 211, 238, 0.08) !important;
            transition: all 0.2s ease-out !important;
        }
    `;
    document.head.appendChild(style);
}

function flashRow(element: HTMLElement) {
    element.classList.add('crawlpilot-highlight');
    setTimeout(() => element.classList.remove('crawlpilot-highlight'), 600);
}

/** Count updates go out in batches (every 10 rows or 500 ms), not per row. */
function queueUpdate(total: number) {
    rowTotal = total;
    pendingUpdates++;
    if (pendingUpdates >= UPDATE_BATCH_SIZE) { flushUpdates(); return; }
    if (!updateTimer) updateTimer = setTimeout(flushUpdates, UPDATE_INTERVAL_MS);
}

function flushUpdates() {
    if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
    if (pendingUpdates === 0) return;
    pendingUpdates = 0;
    void send('AUTO_SCROLL_UPDATE', { count: rowTotal });
}

function stopAutoScroll() {
    if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
    pendingUpdates = 0;
    scrollAbort?.abort();
    scrollAbort = null;
}

function stopPagination() {
    paginationAbort?.abort();
    paginationAbort = null;
}

async function startAutoScroll(req: AutoScrollRequest) {
    stopAutoScroll();
    scrollColumns = hasReaders(req.columns) ? req.columns : null;
    scrollAbort = new AbortController();
    const signal = scrollAbort.signal;

    const root = req.container.length > 0 ? resolveContainer(req.container, req.items).result ?? undefined : undefined;

    // The entry of the item chain that finds items in the container (CSS only: the scroll strategy
    // queries with it; otherwise it walks the container's children).
    const { used } = resolveItems(req.items, root || document);
    const found = used >= 0 ? req.items[used] : undefined;
    const selector = found && !looksLikeXPath(found) ? found : undefined;

    const results: Record<string, string>[] = [];
    const seen = new Set<string>();
    let checked = false;

    const autoScroll = new AutoScrollAction({
        selector,
        selectorType: 'selector',
        selectionMode: selector ? 'items' : 'container',
        rootElement: root,
        enableInfiniteScroll: req.enableInfiniteScroll,
        loadMoreSelectors: req.loadMore,
        scrollDelay: req.scrollDelay || 800,
        contentLoadDelay: req.contentLoadDelay || 2500,
        maxNoChanges: 5,
        scrollCallback: async (info: any) => {
            const element: HTMLElement | undefined = info.element;
            if (!element) return;
            if (scrollColumns && !checked) {
                // Saved fields: checked once against the rows loaded now, healed by meaning where they broke.
                checked = true;
                let rows: Element[] = [];
                try { rows = selector ? Array.from((root || document).querySelectorAll(selector)) : []; } catch { /* bad selector */ }
                if (rows.length < 2) rows = similarSiblings(element);
                const health = checkPage(rows, scrollColumns);
                scrollColumns = health.columns;
                if (health.healed.length || health.broken.length) console.log('[AutoScroll] Field check', health.healed, health.broken);
            }
            if (!scrollColumns) {
                // No saved fields: infer them once from the rows loaded now, then freeze them.
                let sample: Element[] = [];
                try { sample = selector ? Array.from((root || document).querySelectorAll(selector)) : []; } catch { /* bad selector */ }
                if (sample.length < 2) sample = similarSiblings(element);
                scrollColumns = inferFields(sample).columns;
            }
            await refreshNetSourcesFor(scrollColumns);
            const { item: row } = await readWhenReady(element, scrollColumns, () => settle(element, 300, 1000));
            if (Object.keys(row).length === 0) return;
            const hash = hashString(JSON.stringify(row)).toString();
            if (seen.has(hash)) return;
            seen.add(hash);
            results.push(row);
            queueUpdate(results.length);
            flashRow(element);
        }
    } as any);

    try {
        await autoScroll.execute({ signal, logger: console, state: new Map(), onProgress: () => undefined });
        flushUpdates();
        void send('AUTO_SCROLL_COMPLETE', ok({ items: results, columns: scrollColumns ?? [] }));
    } catch (e: any) {
        if (e.message === 'Action aborted') return;
        console.error('AutoScroll Failed', e);
        void send('AUTO_SCROLL_COMPLETE', fail(e.message));
    } finally {
        scrollColumns = null;
    }
}

async function startPagination(req: PaginationRequest) {
    stopPagination();
    sentPaginationColumns = null;
    paginationAbort = new AbortController();

    const pagination = new PaginationAction({ ...req, columns: hasReaders(req.columns) ? req.columns : undefined });

    await pagination.execute({
        signal: paginationAbort.signal,
        logger: console,
        state: new Map(),
        onProgress: (progress: any) => {
            if (progress.type === 'data') {
                // The fields go to the side panel once (they are frozen for the run), so it saves them as the columns.
                const columns = progress.columns && progress.columns !== sentPaginationColumns ? progress.columns : undefined;
                if (columns) sentPaginationColumns = columns;
                void send('PAGINATION_UPDATE', { items: progress.items, page: progress.page, total: progress.cumulativeTotal, columns, unmapped: progress.unmapped, fallback: progress.fallback, healedItems: progress.healedItems, healedFields: progress.healedFields, brokenFields: progress.brokenFields });
            } else if (progress.type === 'complete') {
                void send('PAGINATION_COMPLETE', ok({ reason: progress.reason }));
            } else if (progress.type === 'error') {
                void send('PAGINATION_COMPLETE', fail(progress.message));
            }
        }
    });
}

/** A pagination run that navigated to the next page continues here (PaginationAction saves its state before navigating). */
function resumePagination() {
    void storage.get('pagination_state').then(state => {
        if (state?.isRunning) {
            void startPagination({
                ...state.config,
                resumeState: { pageCount: state.pageCount, totalItems: state.totalItems, visitedUrls: state.visitedUrls }
            });
        } else if (state) {
            void storage.remove('pagination_state');
        }
    });
}

export function registerListRunHandlers() {
    injectHighlightStyle();
    on('EXECUTE_AUTO_SCROLL', req => { void startAutoScroll(req); return ok(); });
    on('STOP_AUTO_SCROLL', () => { stopAutoScroll(); stopPagination(); return ok(); });
    on('EXECUTE_PAGINATION', req => { void startPagination(req); return ok(); });
    on('STOP_PAGINATION', () => { stopPagination(); return ok(); });
    resumePagination();
}
