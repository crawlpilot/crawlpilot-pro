import contentScriptPath from '../../content/element-selector?script';

const ALL_URLS_ORIGINS = ['<all_urls>'];

export type PermissionRequestResult = 'granted' | 'denied' | 'unavailable';

export function hasAllUrlsPermission(): Promise<boolean> {
    return chrome.permissions.contains({ origins: ALL_URLS_ORIGINS });
}

/**
 * chrome.permissions.request() can reject without ever showing a dialog — e.g. when the
 * user-gesture token has expired or when the prompt can't be anchored to the side panel.
 * Callers must treat 'unavailable' differently from 'denied': the user never saw a
 * confirmation, so give them a manual path via openSiteAccessSettings() instead of
 * failing silently.
 */
export async function requestAllUrlsPermission(): Promise<PermissionRequestResult> {
    try {
        const granted = await chrome.permissions.request({ origins: ALL_URLS_ORIGINS });
        return granted ? 'granted' : 'denied';
    } catch (e) {
        console.error('[permissions] Request failed without showing a prompt:', e);
        return 'unavailable';
    }
}

/**
 * Last-resort fallback when the permission dialog can't be shown: open the extension's
 * own details page where the user can set Site access → "On all sites" manually.
 */
export function openSiteAccessSettings(): void {
    void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
}

/**
 * Statically declared content scripts only run in pages loaded after the extension gained
 * access, so on first grant every already-open tab would stay dead until a manual reload.
 * Inject into all open http(s) tabs instead. Double injection is safe: the crxjs loader
 * dynamic-imports the same module URL, so the page's ES module cache makes re-runs a no-op.
 */
export async function injectContentScriptIntoOpenTabs(): Promise<void> {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    await Promise.allSettled(
        tabs
            .filter(t => t.id != null && !t.discarded)
            .map(t => chrome.scripting.executeScript({
                target: { tabId: t.id! },
                files: [contentScriptPath],
            }))
    );
}
