import { useState, useEffect, useCallback } from 'react';

import contentScriptPath from '../../content/element-selector?script';

export function useTabSync() {
    const [isTabConnected, setIsTabConnected] = useState(true);
    const [activeTabId, setActiveTabId] = useState<number | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);

    const checkConnection = useCallback(async (tabId: number) => {
        try {
            // [NEW] Check if it's a restricted page (extension page, etc.)
            const tab = await chrome.tabs.get(tabId);
            if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('about:')) {
                setIsTabConnected(true);
                return;
            }

            // Ping content script
            await chrome.tabs.sendMessage(tabId, { type: 'PING' });
            setIsTabConnected(true);
        } catch (e) {
            setIsTabConnected(false);
        }
    }, []);

    const connectTab = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;

        setIsConnecting(true);
        try {
            // Request host permission dynamically before injecting
            const hasPermission = await chrome.permissions.contains({
                origins: ['<all_urls>']
            });

            if (!hasPermission) {
                const granted = await chrome.permissions.request({
                    origins: ['<all_urls>']
                });

                if (!granted) {
                    setIsConnecting(false);
                    return;
                }
            }

            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: [contentScriptPath]
            });

            // Wait a bit then check
            setTimeout(() => {
                checkConnection(tab.id!);
                setIsConnecting(false);
            }, 500);
        } catch (e) {
            console.error('Failed to connect tab:', e);
            setIsConnecting(false);
        }
    };

    useEffect(() => {
        // Initial check
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                setActiveTabId(tabs[0].id);
                checkConnection(tabs[0].id);
            }
        });

        // Listen for tab activation
        const onActivated = (activeInfo: any) => {
            setActiveTabId(activeInfo.tabId);
            checkConnection(activeInfo.tabId);
        };

        // Listen for tab updates (URL change)
        const onUpdated = (tabId: number, changeInfo: any, tab: chrome.tabs.Tab) => {
            if (changeInfo.status === 'complete' && tab.active) {
                setActiveTabId(tabId);
                checkConnection(tabId);
            }
        };

        chrome.tabs.onActivated.addListener(onActivated);
        chrome.tabs.onUpdated.addListener(onUpdated);

        return () => {
            chrome.tabs.onActivated.removeListener(onActivated);
            chrome.tabs.onUpdated.removeListener(onUpdated);
        };
    }, [checkConnection]);

    return { isTabConnected, isConnecting, connectTab, activeTabId };
}
