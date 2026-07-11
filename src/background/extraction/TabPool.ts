/**
 * TabPool — manages a pool of browser tabs for background extraction.
 *
 * Two tab modes, matching the reference (background-readable.js):
 *
 *   needsInteraction: true  — popup window (focused:false, type:'popup').
 *     The tab is active within its own window → Chrome runs rAF at full speed,
 *     real click events work, no visibility spoofing needed.
 *     Window is closed on releaseTab. User's focus is never stolen.
 *
 *   needsInteraction: false — silent background tab (active:false).
 *     For read-only extraction. rAF is throttled but no clicks are fired, so
 *     it doesn't matter. Tab is closed on releaseTab.
 *
 * Max pool size: 5 tabs (configurable, hard cap at 5)
 */

const MAX_POOL_SIZE = 5;
const CONTENT_SCRIPT_PING_RETRIES = 20;
const CONTENT_SCRIPT_PING_INTERVAL = 500;
const CONTENT_SCRIPT_INIT_WAIT_FRESH = 1500;  // first load — wait for dynamic import

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
    // Reservations for acquisitions that passed the size gate but haven't been
    // inserted into `tabs` yet (tab/window creation is async).
    private pendingCount = 0;
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

    /**
     * Acquires a tab for extraction.
     *
     * needsInteraction: true  → popup window (focused:false). The tab is active
     *   within its own window so Chrome runs rAF at full speed and real clicks work.
     *   Matches the reference pattern: active:true tabs for interactive automation.
     *
     * needsInteraction: false → silent background tab (active:false). For read-only
     *   extraction where no clicks are fired and rAF speed doesn't matter.
     */
    async acquireTab(url: string, needsInteraction = false): Promise<number | null> {
        // Reserve a slot synchronously before any await — otherwise two concurrent
        // acquisitions can both pass the size gate and exceed maxSize.
        if (this.tabs.size + this.pendingCount >= this.maxSize) {
            console.warn(`[TabPool] Pool full (${this.tabs.size}+${this.pendingCount} pending/${this.maxSize}) — returning null for ${url}`);
            return null;
        }
        this.pendingCount++;
        try {
            if (needsInteraction) {
                // Popup window: focused:false keeps user focus, but the tab IS active in its
                // own window → full-speed rAF → React accordion clicks work correctly.
                const win = await chrome.windows.create({
                    url,
                    type: 'popup',
                    focused: false,
                    width: 1280,
                    height: 900,
                    left: 0,
                    top: 0,
                });
                if (!win) return null;
                const tab = win.tabs?.[0];
                if (!tab?.id || !win.id) {
                    try { await chrome.windows.remove(win.id!); } catch { /* already gone */ }
                    return null;
                }
                console.log(`[TabPool] Created popup window ${win.id}, tab ${tab.id} for ${url}`);
                return await this._finishAcquire(tab.id, url, win.id, true);
            }

            // Background tab: silent, no popup. rAF is throttled but no clicks are needed.
            const tab = await chrome.tabs.create({ url, active: false });
            if (!tab.id) return null;
            console.log(`[TabPool] Created background tab ${tab.id} for ${url}`);
            return await this._finishAcquire(tab.id, url, tab.windowId!, false);
        } finally {
            this.pendingCount--;
        }
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
        console.log(`[TabPool] Waiting ${CONTENT_SCRIPT_INIT_WAIT_FRESH} ms for content script init on tab ${tabId}`);
        await new Promise(r => setTimeout(r, CONTENT_SCRIPT_INIT_WAIT_FRESH));

        let lastError: string | undefined;
        let injectionAttempted = false;

        for (let i = 0; i < CONTENT_SCRIPT_PING_RETRIES; i++) {
            if (this.shouldStop) return false;

            try {
                const response = await new Promise<any>((resolve) => {
                    chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
                        if (chrome.runtime.lastError) {
                            lastError = chrome.runtime.lastError.message;
                            resolve(null);
                        } else {
                            resolve(res);
                        }
                    });
                });

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

    /**
     * Sends a message to a tab's content script with retry logic.
     */
    async sendMessage(tabId: number, message: any, maxRetries = 10, interval = 500): Promise<any> {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const response = await new Promise<any>((resolve) => {
                chrome.tabs.sendMessage(tabId, message, (res) => {
                    if (chrome.runtime.lastError) {
                        resolve({ success: false, error: chrome.runtime.lastError.message, isConnectionError: true });
                    } else {
                        resolve(res);
                    }
                });
            });

            if (response?.isConnectionError) {
                await new Promise(r => setTimeout(r, interval));
            } else {
                return response;
            }
        }
        return { success: false, error: 'Max retries reached.' };
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
