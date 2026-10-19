import { MessageType, Payload, Reply, sendToTab } from '../../shared/messages';
/**
 * TabPool — the browser tabs a run reads its pages in (`docs/plans/page-extractor-background-plan.md` P4).
 *
 *   'background' (every run): a tab opened with active:false, never discarded while in use. A run with
 *     click steps also gets `visible-shim.js` (JobRunner), so the hidden tab animates and loads its
 *     sections as a visible one would. Nothing is put on the user's screen.
 *
 *   'window' (last resort): a small unfocused popup parked in the screen's bottom-right corner, for
 *     a site whose clicks have no effect in a hidden tab. It is never placed over the user's window.
 *
 * Max pool size: 5 tabs (configurable, hard cap at 5)
 */

const MAX_POOL_SIZE = 5;
const CONTENT_SCRIPT_PING_RETRIES = 20;
const CONTENT_SCRIPT_PING_INTERVAL = 500;
const CONTENT_SCRIPT_INIT_WAIT_FRESH = 1500;  // first load — wait for dynamic import
const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 360;

/**
 * A small unfocused popup in the bottom-right corner of the user's screen (Chrome rejects bounds less
 * than half on screen: a rejected placement is retried with Chrome's own).
 */
async function createPopup(url: string): Promise<chrome.windows.Window | undefined> {
    const base = { url, type: 'popup' as const, focused: false };
    const last = await chrome.windows.getLastFocused().catch(() => undefined);
    const right = (last?.left ?? 0) + (last?.width ?? POPUP_WIDTH);
    const bottom = (last?.top ?? 0) + (last?.height ?? POPUP_HEIGHT);
    const bounds = { width: POPUP_WIDTH, height: POPUP_HEIGHT, left: Math.max(0, right - POPUP_WIDTH), top: Math.max(0, bottom - POPUP_HEIGHT) };
    try {
        return await chrome.windows.create({ ...base, ...bounds });
    } catch (e) {
        console.warn('[TabPool] Popup bounds rejected, using the default placement:', e);
        return chrome.windows.create(base);
    }
}

export interface PoolTab {
    tabId: number;
    url: string;
    status: 'loading' | 'ready' | 'extracting' | 'error';
    windowId: number;
    isPopup: boolean;   // true = popup window; releaseTab closes the whole window
}

export class TabPool {
    private tabs: Map<number, PoolTab> = new Map();
    private maxSize: number;
    private onTabRemoved: ((tabId: number) => void) | null = null;
    private tabRemovedListener: ((tabId: number) => void) | null = null;
    shouldStop = false;

    constructor(
        maxSize: number = 3,
        _viewportWidth = 800,
        _viewportHeight = 600,
        private tabLoadTimeout = 30000,
        private shouldWaitForLoad = true
    ) {
        this.maxSize = Math.min(maxSize, MAX_POOL_SIZE);
        this.setupListeners();
    }

    private setupListeners() {
        this.tabRemovedListener = (tabId: number) => {
            if (this.tabs.has(tabId)) {
                console.log(`[TabPool] Tab ${tabId} was closed externally`);
                this.tabs.delete(tabId);
                if (this.onTabRemoved) {
                    this.onTabRemoved(tabId);
                }
            }
        };
        chrome.tabs.onRemoved.addListener(this.tabRemovedListener);
    }

    setOnTabRemoved(handler: (tabId: number) => void) {
        this.onTabRemoved = handler;
    }

    get activeCount(): number {
        return this.tabs.size;
    }

    get availableSlots(): number {
        return this.maxSize - this.tabs.size;
    }

    /** Opens `url` in a hidden background tab, or (`window`) in a parked popup: see the header. */
    async acquireTab(url: string, mode: 'background' | 'window' = 'background'): Promise<number | null> {
        if (this.tabs.size >= this.maxSize) {
            console.warn(`[TabPool] Pool full (${this.tabs.size}/${this.maxSize}) — returning null for ${url}`);
            return null;
        }

        if (mode === 'window') {
            const win = await createPopup(url);
            if (!win) return null;
            const tab = win.tabs?.[0];
            if (!tab?.id || !win.id) {
                try { await chrome.windows.remove(win.id!); } catch { /* already gone */ }
                return null;
            }
            console.log(`[TabPool] Created popup window ${win.id}, tab ${tab.id} for ${url}`);
            return this._finishAcquire(tab.id, url, win.id, true);
        }

        const tab = await chrome.tabs.create({ url, active: false });
        if (!tab.id) return null;
        // Chrome may discard a hidden tab under memory pressure: not while a run reads it.
        await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
        console.log(`[TabPool] Created background tab ${tab.id} for ${url}`);
        return this._finishAcquire(tab.id, url, tab.windowId!, false);
    }

    private async _finishAcquire(tabId: number, url: string, windowId: number, isPopup: boolean): Promise<number | null> {
        const poolTab: PoolTab = { tabId, url, status: 'loading', windowId, isPopup };
        this.tabs.set(tabId, poolTab);

        if (this.shouldWaitForLoad) {
            const loadStart = Date.now();
            await this.waitForTabLoad(tabId, this.tabLoadTimeout);
            console.log(`[TabPool] Tab ${tabId} load finished in ${Date.now() - loadStart} ms (${url})`);
        }

        const scriptReady = await this.ensureContentScript(tabId);
        if (!scriptReady) {
            console.error(`[TabPool] ❌ Content script not ready for tab ${tabId} (${url}) — discarding tab`);
            this.tabs.delete(tabId);
            try {
                if (isPopup) await chrome.windows.remove(windowId);
                else await chrome.tabs.remove(tabId);
            } catch { /* already gone */ }
            return null;
        }

        poolTab.status = 'ready';
        console.log(`[TabPool] ✅ Tab ${tabId} ready for extraction (${url})`);
        return tabId;
    }

    /**
     * Marks a tab as actively extracting.
     */
    markExtracting(tabId: number) {
        const tab = this.tabs.get(tabId);
        if (tab) tab.status = 'extracting';
    }

    /**
     * Closes the tab (or its popup window) and removes it from the pool.
     */
    async releaseTab(tabId: number) {
        const poolTab = this.tabs.get(tabId);
        this.tabs.delete(tabId);
        try {
            if (poolTab?.isPopup) await chrome.windows.remove(poolTab.windowId);
            else await chrome.tabs.remove(tabId);
        } catch { /* already gone */ }
    }

    /**
     * Waits for a tab to finish loading (status === 'complete').
     */
    private waitForTabLoad(tabId: number, timeout: number = 30000): Promise<void> {
        return new Promise((resolve) => {
            const cap = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(onUpdated);
                console.warn(`[TabPool] Tab ${tabId} load timed out after ${timeout} ms — proceeding anyway`);
                resolve();
            }, timeout);

            const onUpdated = (id: number, info: { status?: string }) => {
                if (id === tabId && info.status === 'complete') {
                    clearTimeout(cap);
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    resolve();
                }
            };

            chrome.tabs.onUpdated.addListener(onUpdated);

            // Check if already loaded
            chrome.tabs.get(tabId, (t) => {
                if (chrome.runtime.lastError) {
                    clearTimeout(cap);
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    resolve();
                    return;
                }
                if (t?.status === 'complete') {
                    clearTimeout(cap);
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    resolve();
                }
            });
        });
    }

    /**
     * Verifies the content script is responsive via PING.
     * Falls back to programmatic injection if the manifest-declared script didn't inject.
     */
    private async ensureContentScript(tabId: number): Promise<boolean> {
        // No fixed pre-PING sleep — the manifest content script runs at document_idle,
        // which by the time waitForTabLoad() resolves (tab status 'complete') has almost
        // always already loaded. The retry loop below still backs off CONTENT_SCRIPT_PING_INTERVAL
        // between attempts, so a genuinely slow-loading script gets the same total budget
        // (~10s); this just removes a wasted fixed delay in the common already-ready case.
        let lastError: string | undefined;
        let injectionAttempted = false;

        for (let i = 0; i < CONTENT_SCRIPT_PING_RETRIES; i++) {
            if (this.shouldStop) return false;

            try {
                const response = await sendToTab(tabId, 'PING').catch((e: Error) => { lastError = e.message; return null; });

                if (response?.success) {
                    console.log(`[TabPool] Content script ready on tab ${tabId} (attempt ${i + 1})`);
                    return true;
                }
            } catch (e: any) {
                lastError = e.message;
            }

            // After a few failed PINGs, attempt programmatic injection as fallback.
            if (i === 2 && !injectionAttempted) {
                injectionAttempted = true;
                const loaderFiles = (chrome.runtime.getManifest() as any)
                    ?.content_scripts?.[0]?.js as string[] | undefined;

                if (loaderFiles && loaderFiles.length > 0) {
                    console.log(`[TabPool] Attempting programmatic injection on tab ${tabId} (${loaderFiles[0]})`);
                    try {
                        await chrome.scripting.executeScript({ target: { tabId }, files: loaderFiles });
                        console.log(`[TabPool] ✅ Programmatic injection succeeded on tab ${tabId}`);
                        await new Promise(r => setTimeout(r, CONTENT_SCRIPT_INIT_WAIT_FRESH));
                        continue;
                    } catch (injErr: any) {
                        console.warn(`[TabPool] Programmatic injection failed on tab ${tabId}: ${injErr.message}`);
                    }
                }
            }

            if (i === 0 || i === 4 || i === 9 || i === 14 || i === CONTENT_SCRIPT_PING_RETRIES - 1) {
                console.log(`[TabPool] PING attempt ${i + 1}/${CONTENT_SCRIPT_PING_RETRIES} on tab ${tabId} — no response yet (${lastError ?? 'null response'})`);
            }

            await new Promise(r => setTimeout(r, CONTENT_SCRIPT_PING_INTERVAL));
        }

        console.error(`[TabPool] ❌ Content script not responsive on tab ${tabId} after ${CONTENT_SCRIPT_PING_RETRIES} attempts. Last error: ${lastError ?? 'null response'}`);
        return false;
    }

    /** Sends to a tab's content script, retrying while the script isn't connected yet. */
    async sendMessage<T extends MessageType>(tabId: number, type: T, payload: Payload<T>, maxRetries = 10, interval = 500): Promise<Reply<T>> {
        let error = 'Max retries reached.';
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await sendToTab(tabId, type, ...([payload] as any));
            } catch (e: any) {
                error = e?.message || error;
                await new Promise(r => setTimeout(r, interval));
            }
        }
        // Every content-script reply carries `success` / `error`.
        return { success: false, error } as Reply<T>;
    }

    /**
     * Closes all pool tabs (and their popup windows where applicable).
     */
    async destroyAll() {
        this.shouldStop = true;
        if (this.tabRemovedListener) {
            chrome.tabs.onRemoved.removeListener(this.tabRemovedListener);
        }

        for (const [, poolTab] of this.tabs) {
            try {
                if (poolTab.isPopup) await chrome.windows.remove(poolTab.windowId);
                else await chrome.tabs.remove(poolTab.tabId);
            } catch { /* already gone */ }
        }
        this.tabs.clear();
    }

    /**
     * Gets current pool state for debugging/progress reporting.
     */
    getState(): PoolTab[] {
        return Array.from(this.tabs.values());
    }
}
