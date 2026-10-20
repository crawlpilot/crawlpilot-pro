/** List Extractor runs on this page: auto-scroll and next-button pagination, read with the list's frozen fields. */
import { AutoScrollAction } from '../features/autoscroll/AutoScrollAction';
import { settle } from '../utils/settle';
import { PaginationAction } from '../features/pagination/PaginationAction';
import { refreshNetSources, refreshNetSourcesFor } from '../services/extraction/structuredRows';
import { checkPage, hasReaders, inferFields, readWhenReady, similarSiblings, ReaderColumn } from '../services/extraction/fields';
import { HL_COLOR, HL_GLOW } from '../utils/highlight-tokens';
import { looksLikeXPath, resolveContainer, resolveItems } from '../../shared/selectors/resolve';
import { hashString } from '../../shared/utils/hash';
import { AutoScrollRequest, fail, ok, on, PaginationRequest, send, type ListPageRequest } from '../../shared/messages';
import { until } from '../utils/clock';
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
/** Rows read since the last update: sent with it, so the side panel has every row even if the run is cut short. */
let unsentRows: Record<string, string>[] = [];
let sentScrollColumns: unknown = null;
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
function queueUpdate(total: number, row: Record<string, string>) {
    rowTotal = total;
    unsentRows.push(row);
    pendingUpdates++;
    if (pendingUpdates >= UPDATE_BATCH_SIZE) { flushUpdates(); return; }
    if (!updateTimer) updateTimer = setTimeout(flushUpdates, UPDATE_INTERVAL_MS);
}

function flushUpdates() {
    if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
    if (pendingUpdates === 0) return;
    pendingUpdates = 0;
    const items = unsentRows;
    unsentRows = [];
    const columns = scrollColumns && scrollColumns !== sentScrollColumns ? scrollColumns : undefined;
    if (columns) sentScrollColumns = columns;
    void send('AUTO_SCROLL_UPDATE', { count: rowTotal, items, ...(columns ? { columns } : {}) });
}

function stopAutoScroll() {
    // The rows read so far go out now: they are what a stopped run saves.
    flushUpdates();
    scrollAbort?.abort();
    scrollAbort = null;
}

function stopPagination() {
    paginationAbort?.abort();
    paginationAbort = null;
}

async function startAutoScroll(req: AutoScrollRequest) {
    stopAutoScroll();
    unsentRows = [];
    sentScrollColumns = null;
    scrollColumns = hasReaders(req.columns) ? req.columns : null;
    scrollAbort = new AbortController();
    const signal = scrollAbort.signal;

    // The API responses the scroll brings: a field found in the page's JSON reads the rows they hold.
    await send('NET_HOOK_START');
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
        // An app that re-renders the list replaces its container: found again from the same chains.
        resolveRoot: req.container.length > 0 ? () => (resolveContainer(req.container, req.items).result as HTMLElement | null) ?? null : undefined,
        enableInfiniteScroll: req.enableInfiniteScroll,
        loadMoreSelectors: req.loadMore,
        scrollDelay: req.scrollDelay || 800,
        contentLoadDelay: req.contentLoadDelay || 2500,
        maxNoChanges: 5,
        maxItems: req.maxItems,
        maxMs: req.maxMs,
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
            let { item: row } = await readWhenReady(element, scrollColumns, () => settle(element, 300, 1000));
            // A row the scroll just loaded: its data may be in a response newer than the last refresh.
            if (scrollColumns.some(c => c.reader?.json && !row[c.id])) {
                await refreshNetSources();
                ({ item: row } = await readWhenReady(element, scrollColumns, () => settle(element, 300, 1000)));
            }
            if (Object.keys(row).length === 0) return;
            // The same item read twice (the list mounted it again) has the same key; two items with the
            // same values are still two rows.
            const hash = info.key ?? hashString(JSON.stringify(row)).toString();
            if (seen.has(hash)) return;
            seen.add(hash);
            results.push(row);
            queueUpdate(results.length, row);
            flashRow(element);
        }
    } as any);

    // The page going away (a link clicked, the tab navigated) ends the run with what it read.
    const onLeave = () => {
        flushUpdates();
        void send('AUTO_SCROLL_COMPLETE', ok({ items: results, columns: scrollColumns ?? [] }));
    };
    addEventListener('pagehide', onLeave, { once: true });
    try {
        await autoScroll.execute({ signal, logger: console, state: new Map(), onProgress: () => undefined });
        removeEventListener('pagehide', onLeave);
        flushUpdates();
        void send('AUTO_SCROLL_COMPLETE', ok({ items: results, columns: scrollColumns ?? [] }));
    } catch (e: any) {
        removeEventListener('pagehide', onLeave);
        if (e.message === 'Action aborted') return;
        console.error('AutoScroll Failed', e);
        void send('AUTO_SCROLL_COMPLETE', fail(e.message));
    } finally {
        scrollColumns = null;
    }
}

/** When the running pagination began (`PaginationRequest.startedAt`). */
let paginationStartedAt = 0;

async function startPagination(req: PaginationRequest) {
    stopPagination();
    sentPaginationColumns = null;
    paginationAbort = new AbortController();
    // A new run starts its clock here; a resumed one keeps the first page's.
    req = { ...req, startedAt: req.startedAt ?? Date.now() };
    paginationStartedAt = req.startedAt!;

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
                void send('PAGINATION_UPDATE', { items: progress.items, page: progress.page, total: progress.cumulativeTotal, columns, unmapped: progress.unmapped, fallback: progress.fallback, healedItems: progress.healedItems, healedFields: progress.healedFields, brokenFields: progress.brokenFields, loading: progress.loading });
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
    void Promise.all([storage.get('pagination_state'), storage.get('pagination_stopped_at')]).then(([state, stoppedAt]) => {
        // Stopped while this page was loading: the Stop went to the page before, which is gone.
        if (state?.isRunning && stoppedAt && stoppedAt >= (state.config.startedAt ?? state.timestamp)) {
            void storage.remove('pagination_state');
            void send('PAGINATION_COMPLETE', ok({ reason: 'cancelled' }));
            return;
        }
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

/** How long a page opened by a numbered-pages run has to show its list, and how long once it has loaded. */
const LIST_WAIT_MS = 15_000;
const LIST_WAIT_LOADED_MS = 4_000;

/**
 * One page of a numbered-pages run (`listing/urlPages.ts`), in a background tab: the list found by its
 * chains once it renders, its fields checked (healed by meaning where they broke), each item read once
 * it has loaded. No scrolling to the next page and no clicks: the run opens each page by its address.
 */
async function readListPage(req: ListPageRequest): Promise<{ rows: Record<string, string>[]; columns: ReaderColumn[]; healed?: string[]; broken?: string[] }> {
    const find = () => {
        const root = req.container.length > 0 ? resolveContainer(req.container, req.items).result : null;
        return resolveItems(req.items, root ?? document).result;
    };
    // A page past the last one (an error page, an empty listing) never shows the list: no long wait once it has loaded.
    const started = Date.now();
    await until(() => find().length > 0 || (document.readyState === 'complete' && Date.now() - started > LIST_WAIT_LOADED_MS), LIST_WAIT_MS);
    const items = find();
    if (items.length === 0) return { rows: [], columns: hasReaders(req.columns) ? req.columns : [] };
    let columns: ReaderColumn[];
    let healed: string[] | undefined, broken: string[] | undefined;
    if (hasReaders(req.columns)) {
        const health = checkPage(items, req.columns);
        columns = health.columns;
        if (health.healed.length) healed = health.healed;
        if (health.broken.length) broken = health.broken;
    } else {
        columns = inferFields(items).columns;
    }
    await refreshNetSourcesFor(columns);
    const rows: Record<string, string>[] = [];
    for (const el of items) {
        if (!el.isConnected) continue;
        // Lazy content (prices, images) fills in when the item comes into view.
        el.scrollIntoView({ block: 'center' });
        const { item } = await readWhenReady(el, columns, () => settle(el, 150, 800));
        if (Object.keys(item).length > 0) rows.push(item);
    }
    return { rows, columns, ...(healed ? { healed } : {}), ...(broken ? { broken } : {}) };
}

export function registerListRunHandlers() {
    on('READ_LIST_PAGE', async req => ok(await readListPage(req)));
    injectHighlightStyle();
    on('EXECUTE_AUTO_SCROLL', req => { void startAutoScroll(req); return ok(); });
    on('STOP_AUTO_SCROLL', () => { stopAutoScroll(); stopPagination(); return ok(); });
    on('EXECUTE_PAGINATION', req => { void startPagination(req); return ok(); });
    on('STOP_PAGINATION', () => { stopPagination(); return ok(); });
    // A Stop recorded while the message couldn't reach this page (or reached the page before it).
    chrome.storage.onChanged.addListener((changes, area) => {
        const at = changes.pagination_stopped_at?.newValue;
        if (area === 'local' && typeof at === 'number' && paginationAbort && at >= paginationStartedAt) stopPagination();
    });
    resumePagination();
}
