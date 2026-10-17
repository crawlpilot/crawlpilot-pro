import { useState, useEffect, useCallback, useRef } from 'react';
import { sendToTab } from '../../shared/messages';

import contentScriptPath from '../../content/element-selector?script';
import { hasAllUrlsPermission, requestAllUrlsPermission, openSiteAccessSettings } from '../../shared/utils/hostPermissions';

const RESTRICTED_PREFIXES = ['chrome://', 'chrome-extension://', 'about:', 'edge://'];

// How long a failed ping must persist before the "not connected" banner appears.
// This absorbs transient failures: SW cold-start, language-switch re-render cascades,
// brief tab navigation flashes. 800 ms is long enough to mask blips but short enough
// that a real disconnection is caught quickly.
const DISCONNECT_DEBOUNCE_MS = 800;
const PING_RETRY_DELAY_MS = 400;
const INJECT_POLL_INTERVAL_MS = 500;
const INJECT_POLL_MAX_ATTEMPTS = 6;
// Small delay on effect mount so React has finished committing renders (e.g. after
// a language change) before we issue the first PING.
const MOUNT_SETTLE_MS = 200;

/**
 * Whether this tab is a page the extension can never run on (chrome://, the Web Store,
 * other extensions). CRITICAL: `tab.url` is only visible once the extension has host
 * access to that tab. Before `<all_urls>` is granted, EVERY url comes back undefined —
 * treating that as "restricted" made checkConnection mark all tabs as connected, so the
 * banner (and with it the permission confirmation) never appeared on fresh installs.
 * Hidden url therefore only counts as restricted when we DO hold `<all_urls>` (then a
 * hidden url really is a chrome:// style page).
 */
async function isRestrictedTab(tab: chrome.tabs.Tab): Promise<boolean> {
    if (tab.url) return RESTRICTED_PREFIXES.some(p => tab.url!.startsWith(p));
    return hasAllUrlsPermission();
}

export function useTabSync() {
    const [isTabConnected, setIsTabConnected] = useState(true);
    const [activeTabId, setActiveTabId] = useState<number | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);

    const activeTabIdRef = useRef<number | null>(null);
    // Timer that fires setIsTabConnected(false) after DISCONNECT_DEBOUNCE_MS of
    // continuous ping failures. Cancelled the moment any ping succeeds.
    const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cancelDisconnect = useCallback(() => {
        if (disconnectTimerRef.current) {
            clearTimeout(disconnectTimerRef.current);
            disconnectTimerRef.current = null;
        }
    }, []);

    const scheduleDisconnect = useCallback(() => {
        // Only start one timer — if it's already running let it run.
        if (disconnectTimerRef.current) return;
        disconnectTimerRef.current = setTimeout(() => {
            disconnectTimerRef.current = null;
            setIsTabConnected(false);
        }, DISCONNECT_DEBOUNCE_MS);
    }, []);

    // Returns true if the tab's content script is reachable.
    // Retries once (with a short delay) before scheduling the debounced disconnect,
    // so a single transient PING failure never immediately shows the banner.
    const checkConnection = useCallback(async (tabId: number, retries = 1): Promise<boolean> => {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const tab = await chrome.tabs.get(tabId);
                if (await isRestrictedTab(tab)) {
                    cancelDisconnect();
                    setIsTabConnected(true);
                    return true;
                }
                await sendToTab(tabId, 'PING');
                cancelDisconnect();          // Success — clear any pending disconnect timer
                setIsTabConnected(true);
                return true;
            } catch {
                if (attempt < retries) {
                    await new Promise(r => setTimeout(r, PING_RETRY_DELAY_MS));
                }
            }
        }
        // All retries exhausted — start the debounce timer instead of flipping state immediately.
        scheduleDisconnect();
        return false;
    }, [cancelDisconnect, scheduleDisconnect]);

    const autoConnect = useCallback(async (tabId: number) => {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (await isRestrictedTab(tab)) return;

            // Try injecting even without <all_urls>: activeTab (granted when the user
            // opened the panel from the action icon) often covers the active tab. If
            // neither permission applies, executeScript rejects and we land in the catch.
            await chrome.scripting.executeScript({ target: { tabId }, files: [contentScriptPath] });

            // Poll until the injected script responds (max ~3 s).
            let attempts = 0;
            const poll = setInterval(async () => {
                attempts++;
                const connected = await checkConnection(tabId, 0);
                if (connected || attempts >= INJECT_POLL_MAX_ATTEMPTS) clearInterval(poll);
            }, INJECT_POLL_INTERVAL_MS);
        } catch (e) {
            console.error('[useTabSync] Auto-connect failed:', e);
        }
    }, [checkConnection]);

    const connectTab = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;

        setIsConnecting(true);
        try {
            const inject = () =>
                chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: [contentScriptPath] });

            try {
                // activeTab may already cover the current tab — no permission prompt needed.
                await inject();
            } catch {
                const result = await requestAllUrlsPermission();
                if (result === 'unavailable') {
                    // Chrome couldn't show the confirmation dialog at all — send the user
                    // to the extension's site-access settings as a manual fallback.
                    openSiteAccessSettings();
                    setIsConnecting(false);
                    return;
                }
                if (result === 'denied') { setIsConnecting(false); return; }
                await inject();
            }

            let attempts = 0;
            const poll = setInterval(async () => {
                attempts++;
                const connected = await checkConnection(tab.id!, 0);
                if (connected || attempts >= INJECT_POLL_MAX_ATTEMPTS) {
                    clearInterval(poll);
                    setIsConnecting(false);
                }
            }, INJECT_POLL_INTERVAL_MS);
        } catch (e) {
            console.error('[useTabSync] Manual connect failed:', e);
            setIsConnecting(false);
        }
    };

    useEffect(() => {
        // Delay the first ping slightly so React can finish committing all renders
        // triggered by the event that caused this effect to mount (language change,
        // initial load, etc.) before we send network messages.
        const mountTimer = setTimeout(() => {
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (!tabs[0]?.id) return;
                const tabId = tabs[0].id;
                setActiveTabId(tabId);
                activeTabIdRef.current = tabId;
                const connected = await checkConnection(tabId);
                if (!connected) autoConnect(tabId);
            });
        }, MOUNT_SETTLE_MS);

        const onActivated = async (activeInfo: { tabId: number; windowId: number }) => {
            setActiveTabId(activeInfo.tabId);
            activeTabIdRef.current = activeInfo.tabId;
            const connected = await checkConnection(activeInfo.tabId);
            if (!connected) autoConnect(activeInfo.tabId);
        };

        const onUpdated = async (tabId: number, changeInfo: { status?: string }, tab: chrome.tabs.Tab) => {
            if (changeInfo.status !== 'complete' || !tab.active) return;
            setActiveTabId(tabId);
            activeTabIdRef.current = tabId;
            const connected = await checkConnection(tabId);
            if (!connected) autoConnect(tabId);
        };

        chrome.tabs.onActivated.addListener(onActivated);
        chrome.tabs.onUpdated.addListener(onUpdated);

        return () => {
            clearTimeout(mountTimer);
            cancelDisconnect(); // Don't fire a stale disconnect timer after unmount
            chrome.tabs.onActivated.removeListener(onActivated);
            chrome.tabs.onUpdated.removeListener(onUpdated);
        };
        // Intentionally excludes isTabConnected — using it as a dep caused a stale-closure
        // loop where each state change re-registered listeners and re-pinged the tab.
    }, [checkConnection, autoConnect, cancelDisconnect]);

    return { isTabConnected, isConnecting, connectTab, activeTabId };
}
