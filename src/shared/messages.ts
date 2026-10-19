/**
 * Every message between the side panel, the background service worker and the content script,
 * with its payload and reply, in one map. Send with `send` (to the extension: background and side
 * panel), `sendToTab` / `sendToActiveTab` (to a page's content script); handle with `on`.
 *
 * A context answers only the types it registered, so a broadcast (progress, picker results) never
 * gets a stray reply from another context.
 */
import type { RevealMode } from './types/reveal';
import type { MetadataExtractOptions, MetadataExtractResult } from './types/metadata';
import type { ExtractedContent } from './types/summarizer';
import type { PageVerdict } from './verdict/classifyPage';
import type { ReconReport } from './recon/types';
import type { PageSummary } from './types/pageSummary';
import type { NextControl } from '../content/services/pagination/findNext';
import type { NetEntry } from './network/types';
import type { LabEval, LabPick } from '../content/features/lab/SelectorLab';
import type { GroundRequest, Grounded, PageView, PickedRegion } from './ai/page';
import type { ClaimRequest, ClaimResult } from './ai/cite';
import type { SiteContacts } from './contacts/find';
import type { Chain } from './types/database';
import type { FoundImage, ImageBatch, ImageScanProgress } from './images/types';

type Fail = { success: false; error: string };
/** A content-script / background reply: its data on success, or an error. */
type Res<T = {}> = ({ success: true; error?: undefined } & T) | Fail;
/** One URL of a bulk or metadata run, as the side panel shows it. */
export interface UrlStatus {
    url: string;
    status: 'queued' | 'extracting' | 'waiting' | 'done' | 'error';
    error?: string;
    verdict?: PageVerdict;
}

export interface RunProgress {
    jobId: number;
    completedUrls: number;
    totalUrls: number;
    currentUrl?: string;
    activeTabs: number;
    urlStatuses: UrlStatus[];
    verdicts?: Record<string, number>;
    previewTableId?: number | null;
    /** Rows read so far. */
    rows?: number;
}

export interface RunComplete {
    jobId: number;
    tableId?: number;
    totalItems: number;
    success: boolean;
    error?: string;
    stoppedByUser?: boolean;
}

export interface BulkStart {
    urls: string[];
    elements: any[];
    config: any;
    jobId?: number;
    customName?: string;
    maxConcurrent?: number;
}

export interface ContactsStart {
    urls: string[];
    /** Contact pages read per site besides the one opened. */
    follow?: number;
    /** Only addresses on each company's own domain. */
    ownOnly?: boolean;
    maxConcurrent?: number;
    requestDelay?: number;
    customName?: string;
}

export interface ApiStart {
    spec: import('./network/apiRecipe').ApiSpec;
    /** Values for the spec's input (one series of pages each); none: the call as recorded. */
    values?: string[];
    /** A re-run: the units of the earlier run as they were. */
    units?: string[];
    maxConcurrent?: number;
    customName?: string;
    jobId?: number;
}

export interface MetadataStart {
    urls: string[];
    options: MetadataExtractOptions;
    maxConcurrent?: number;
    requestDelay?: number;
    loadTimeout?: number;
    customName?: string;
}

/** A picked element, as the picker strategies report it. */
/** What a picked list is: ordinary results, a sponsored shelf, a carousel. */
export type ListKind = 'results' | 'sponsored' | 'carousel';

export interface ElementSelected {
    success: boolean;
    id: string;
    data?: any;
    selectionMode: 'list' | 'single' | 'detail';
    /** A list pick: the container's chain and the items' chain (relative to the container). */
    container?: Chain;
    items?: Chain;
    /** A single element (a Next button, a Page Extractor element): its chain. */
    selectors?: Chain;
    patternFound?: boolean;
    count?: number;
    /** A list pick: what the picked section is ("Results · 18 items", "Sponsored · 3 items"). */
    label?: string;
    kind?: ListKind;
    /** Page Extractor extras: `value`, `previewValue`, `extractionType`, `tagName`, viewport. */
    [key: string]: any;
}

/** Auto-scroll or load-more over a list on this page. */
export interface AutoScrollRequest {
    container: Chain;
    items: Chain;
    /** The Load more control (load-more mode). */
    loadMore?: Chain;
    enableInfiniteScroll?: boolean;
    scrollDelay?: number;
    contentLoadDelay?: number;
    /** The list's frozen fields; every scrolled row is read with them. */
    columns?: unknown;
}

/** Next-button pagination over a list, continued on each page the run navigates to. */
export interface PaginationRequest {
    container: Chain;
    items: Chain;
    next: Chain;
    maxPages?: number;
    mode?: string;
    resumeState?: { pageCount: number; totalItems: number; visitedUrls: string[] };
    /** When the run began (set on its first page, carried to the next): a Stop after it ends the run on any page. */
    startedAt?: number;
    columns?: unknown;
    navigationDelay?: number;
    contentLoadDelay?: number;
    pageLoadDelay?: number;
    urlChangeTimeout?: number;
}

export interface Messages {
    // ---- side panel / background → content script
    PING: { reply: Res<{ status: string }> };
    /** Reads a list from its chains (switching a pick to one of its alternatives). */
    START_PICKER: { payload: { mode?: 'list' | 'single' | 'detail'; action?: 'extract' | 'click' }; reply: Res };
    STOP_PICKER: { reply: Res };
    PICKER_ACTION: { payload: { action: string }; reply: Res };
    SHOW_SELECTION_HIGHLIGHTS: { payload: { elements: any[] }; reply: Res };
    CLEAR_SELECTION_HIGHLIGHTS: { reply: Res };
    ADD_SELECTION_HIGHLIGHT: { payload: { element: any }; reply: Res };
    TEST_SELECTOR: { payload: { selector: string }; reply: Res };
    EXECUTE_AUTO_SCROLL: { payload: AutoScrollRequest; reply: Res };
    STOP_AUTO_SCROLL: { reply: Res };
    EXECUTE_PAGINATION: { payload: PaginationRequest; reply: Res };
    STOP_PAGINATION: { reply: Res };
    SCAN_IMAGES: { reply: Res<{ images: FoundImage[] }> };
    SCAN_IMAGES_DEEP: { reply: Res<{ images: FoundImage[] }> };
    SCAN_IMAGES_CANCEL: { reply: Res };
    SCAN_IMAGES_LIVE_START: { reply: Res };
    SCAN_IMAGES_LIVE_STOP: { reply: Res };
    SHOW_IMAGE: { payload: { src: string }; reply: Res };
    /** The page's own fetch of an image (its cookies, `Referer` and `blob:` URLs), as a data URL. */
    FETCH_IMAGE: { payload: { url: string }; reply: { success: true; dataUrl: string } | (Fail & { status?: number }) };
    TOGGLE_RIGHT_CLICK: { payload: { enable: boolean }; reply: Res<{ enabled: boolean }> };
    CMD_EXTRACT_PAGE_BACKGROUND: { payload: { url: string; elements: any[]; config: any }; reply: Res<{ result: { columns: any[]; item: any; items?: any[]; url: string } }> };
    CMD_EXTRACT_METADATA: { payload: { url: string; options: MetadataExtractOptions }; reply: Res<{ result: MetadataExtractResult }> };
    CMD_RECON: { reply: Res<{ report: ReconReport }> };
    /** What the page is (a list, a product, an article): Home's suggestion. */
    PAGE_SUMMARY: { reply: Res<{ summary: PageSummary }> };
    /** The list's Next or "Load more" control, found without a pick (null: none on this page). */
    FIND_NEXT: { reply: Res<{ control: NextControl | null }> };
    LAB_EVAL: { payload: { selector: string; expected?: number; highlight?: boolean }; reply: Res<{ result: LabEval }> };
    LAB_CLEAR: { reply: Res };
    LAB_PICK_START: { reply: Res };
    NET_LIST: { reply: Res<{ installed: boolean; entries: NetEntry[] }> };
    NET_CLEAR: { reply: Res };
    PAGE_COOKIE: { reply: Res<{ cookie: string }> };
    AI_PAGE_VIEW: { payload: { chunkChars: number; maxChunks: number; reveal?: RevealMode }; reply: Res<{ view: PageView }> };
    AI_GROUND: { payload: { requests: GroundRequest[] }; reply: Res<{ results: Grounded[] }> };
    /** Page assistant: checks claims against the last page view's blocks, and shows a cited block. */
    AI_CHECK: { payload: { claims: ClaimRequest[] }; reply: Res<{ results: ClaimResult[] }> };
    AI_SHOW: { payload: { ref: string; quote?: string }; reply: Res<{ shown: boolean }> };
    /** Contacts from websites: this page's, and up to `follow` of the site's contact pages. */
    CMD_FIND_CONTACTS: { payload: { follow: number }; reply: Res<SiteContacts> };
    /** An API recipe's call, sent from the page (its origin, its cookies). */
    CMD_API_FETCH: { payload: import('./network/apiRecipe').ApiRequest; reply: Res<{ status: number; text: string }> };
    /** Page assistant: the user points at something on the page; where it is on screen, or null (Esc). */
    AI_PICK_REGION: { reply: Res<{ region: PickedRegion | null }> };

    // ---- content script → side panel (broadcasts)
    ELEMENT_SELECTED: { payload: ElementSelected };
    PICKER_CANCELLED: {};
    LAB_PICKED: { payload: LabPick | null };
    AUTO_SCROLL_UPDATE: { payload: { count: number } };
    AUTO_SCROLL_COMPLETE: { payload: { success: boolean; items?: any[]; columns?: any[]; error?: string } };
    PAGINATION_UPDATE: { payload: { items: any[]; page: number; total?: number; columns?: any[]; unmapped?: number; fallback?: boolean; healedItems?: string; healedFields?: string[]; brokenFields?: string[]; loading?: number } };
    PAGINATION_COMPLETE: { payload: { success: boolean; reason?: string; error?: string } };
    SCAN_IMAGES_PROGRESS: { payload: ImageScanProgress };
    SCAN_IMAGES_BATCH: { payload: ImageBatch };
    SUMMARIZER_EXTRACTION_RESULT: { payload: ExtractedContent };

    // ---- side panel → background
    BULK_EXTRACTION_START: { payload: BulkStart; reply: Res<{ jobId: number; originalCount: number; uniqueCount: number }> };
    /** `running: false`: there was no run to stop (the side panel resets). */
    BULK_EXTRACTION_STOP: { reply: Res<{ running: boolean }> };
    METADATA_EXTRACTION_START: { payload: MetadataStart; reply: Res<{ jobId: number; uniqueCount: number }> };
    METADATA_EXTRACTION_STOP: { reply: Res<{ running: boolean }> };
    /** Contacts from websites (one row per site). */
    CONTACTS_START: { payload: ContactsStart; reply: Res<{ jobId: number; uniqueCount: number }> };
    CONTACTS_STOP: { reply: Res<{ running: boolean }> };
    /** An API recipe: the site's JSON call sent again page by page, from one tab of the site. */
    API_START: { payload: ApiStart; reply: Res<{ jobId: number; uniqueCount: number }> };
    API_STOP: { reply: Res<{ running: boolean }> };

    // ---- background → side panel (broadcasts)
    BULK_EXTRACTION_PROGRESS: { payload: RunProgress };
    BULK_EXTRACTION_COMPLETE: { payload: RunComplete };
    METADATA_EXTRACTION_PROGRESS: { payload: RunProgress };
    METADATA_EXTRACTION_COMPLETE: { payload: RunComplete };
    CONTACTS_PROGRESS: { payload: RunProgress };
    CONTACTS_COMPLETE: { payload: RunComplete };
    API_PROGRESS: { payload: RunProgress };
    API_COMPLETE: { payload: RunComplete };
}

/** A successful reply carrying `data`. */
export function ok<T extends object = {}>(data?: T): { success: true } & T {
    return { success: true, ...(data as T) };
}

/** A failed reply; `error` may be an Error, a string or anything thrown. */
export function fail(error: unknown, fallback = 'Something went wrong'): Fail {
    return { success: false, error: error instanceof Error ? error.message : typeof error === 'string' && error ? error : fallback };
}

export type MessageType = keyof Messages;

/** The Page Extractor's selection highlights on the page. */
export type HighlightSender = {
    (type: 'SHOW_SELECTION_HIGHLIGHTS', payload: Payload<'SHOW_SELECTION_HIGHLIGHTS'>): Promise<void>;
    (type: 'ADD_SELECTION_HIGHLIGHT', payload: Payload<'ADD_SELECTION_HIGHLIGHT'>): Promise<void>;
    (type: 'CLEAR_SELECTION_HIGHLIGHTS', payload?: undefined): Promise<void>;
};
export type Payload<T extends MessageType> = Messages[T] extends { payload: infer P } ? P : undefined;
export type Reply<T extends MessageType> = Messages[T] extends { reply: infer R } ? R : void;

type PayloadArg<T extends MessageType> = Payload<T> extends undefined ? [payload?: undefined] : [payload: Payload<T>];
type Handler<T extends MessageType> =
    (payload: Payload<T>, sender: chrome.runtime.MessageSender) => Reply<T> | Promise<Reply<T>>;

const handlers = new Map<string, Set<Handler<any>>>();
let installed = false;

/**
 * One chrome listener per context. Every handler of the type runs (broadcasts can have several
 * listeners); the first one that returns something answers.
 */
function install() {
    if (installed) return;
    installed = true;
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        const set = msg && typeof msg.type === 'string' ? handlers.get(msg.type) : undefined;
        if (!set || set.size === 0) return false;
        let reply: unknown;
        for (const handler of [...set]) {
            let r: unknown;
            try {
                r = handler(msg.payload, sender);
            } catch (e) {
                console.error(`[messages] ${msg.type} handler failed:`, e);
                r = fail(e);
            }
            if (reply === undefined && r !== undefined) reply = r;
        }
        if (reply instanceof Promise) {
            reply.then(sendResponse, e => {
                console.error(`[messages] ${msg.type} handler failed:`, e);
                sendResponse(fail(e));
            });
            return true;
        }
        if (reply !== undefined) sendResponse(reply);
        return false;
    });
}

/** Handles a message type in this context. Returns a function that removes the handler. */
export function on<T extends MessageType>(type: T, handler: Handler<T>): () => void {
    install();
    let set = handlers.get(type);
    if (!set) { set = new Set(); handlers.set(type, set); }
    set.add(handler);
    return () => { set!.delete(handler); };
}

/**
 * Sends to the extension (background and side panel). Never throws: resolves `undefined` when
 * nothing is listening (side panel closed) or the extension context is gone.
 */
export function send<T extends MessageType>(type: T, ...[payload]: PayloadArg<T>): Promise<Reply<T> | undefined> {
    return new Promise(resolve => {
        if (!chrome.runtime?.id) { resolve(undefined); return; }
        try {
            chrome.runtime.sendMessage({ type, payload }, res => {
                // Nobody listening (side panel closed) is expected. Reading lastError marks it handled;
                // the read is part of the result so the minifier can't drop it as a no-op (it did).
                resolve(chrome.runtime.lastError ? undefined : res);
            });
        } catch {
            resolve(undefined);
        }
    });
}

/** Sends to a tab's content script. Rejects when the tab has no content script. */
export function sendToTab<T extends MessageType>(tabId: number, type: T, ...[payload]: PayloadArg<T>): Promise<Reply<T>> {
    return chrome.tabs.sendMessage(tabId, { type, payload });
}

/** Sends to the active tab's content script; rejects with a readable message, including on `success: false`. */
export async function sendToActiveTab<T extends MessageType>(type: T, ...[payload]: PayloadArg<T>): Promise<Exclude<Reply<T>, Fail>> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return sendToPage(tab, type, ...([payload] as PayloadArg<T>));
}

/**
 * Like `sendToActiveTab`, to a given tab: a tool that tracks the page it works on (the Scraper
 * Toolkit, or a tool opened in its own tab with `?tabId=`) sends there. Same errors, in plain words.
 */
export async function sendToPage<T extends MessageType>(tab: chrome.tabs.Tab | undefined, type: T, ...[payload]: PayloadArg<T>): Promise<Exclude<Reply<T>, Fail>> {
    if (!tab?.id) throw new Error('No active tab.');
    if (!tab.url || !/^https?:/.test(tab.url)) throw new Error('Open a web page (http or https) to use this tool.');
    try {
        const res: any = await sendToTab(tab.id, type, ...([payload] as PayloadArg<T>));
        if (res && res.success === false) throw new Error(res.error || 'The page could not complete the request.');
        return res;
    } catch (e: any) {
        if (/Receiving end does not exist|Could not establish connection/i.test(e?.message || '')) {
            throw new Error('CrawlPilot is not connected to this page yet. Reload the page and try again.');
        }
        throw e;
    }
}

/** Updates the Page Extractor's selection highlights on the active tab (best effort). */
export const highlightOnActiveTab: HighlightSender = async (type: MessageType, payload?: unknown) => {
    await (sendToActiveTab as (t: MessageType, p?: unknown) => Promise<unknown>)(type, payload).catch(() => { /* page not connected */ });
};
