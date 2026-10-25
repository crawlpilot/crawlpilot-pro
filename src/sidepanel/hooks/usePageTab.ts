/**
 * The page the side panel works on: the active tab, followed as the user switches tabs or the page
 * navigates, or the tab named by `?tabId=` when a view is opened in a tab of its own.
 */
import { useEffect, useState } from 'react';

export interface PageTab {
    tab?: chrome.tabs.Tab;
    url: string;
    title: string;
    host: string;
    favIconUrl?: string;
    /** An http(s) page the tools can work on. */
    web: boolean;
}

function describe(tab?: chrome.tabs.Tab): PageTab {
    const url = tab?.url ?? '';
    let host = '';
    try { host = new URL(url).host; } catch { /* not a URL yet */ }
    return { tab, url, title: tab?.title ?? '', host, favIconUrl: tab?.favIconUrl, web: /^https?:/.test(url) };
}

/** The page the tools work on, kept current as the user switches tabs or the page navigates. */
export function usePageTab(): PageTab {
    const [page, setPage] = useState<PageTab>(() => describe());

    useEffect(() => {
        const pinned = Number(new URLSearchParams(window.location.search).get('tabId')) || null;
        let current: number | null = pinned;
        let alive = true;
        const load = async () => {
            try {
                const tab = pinned ? await chrome.tabs.get(pinned) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
                if (!alive) return;
                current = tab?.id ?? null;
                setPage(describe(tab));
            } catch {
                if (alive) setPage(describe());
            }
        };
        const activated = () => { if (!pinned) void load(); };
        const updated = (tabId: number, change: chrome.tabs.OnUpdatedInfo) => {
            if (tabId === current && (change.url || change.title || change.favIconUrl || change.status === 'complete')) void load();
        };
        void load();
        chrome.tabs.onActivated.addListener(activated);
        chrome.tabs.onUpdated.addListener(updated);
        chrome.windows?.onFocusChanged?.addListener(activated);
        return () => {
            alive = false;
            chrome.tabs.onActivated.removeListener(activated);
            chrome.tabs.onUpdated.removeListener(updated);
            chrome.windows?.onFocusChanged?.removeListener(activated);
        };
    }, []);

    return page;
}

/** The id of the page the panel works on, once: the `?tabId=` tab, else the active tab. */
export async function pageTabId(): Promise<number | undefined> {
    const pinned = Number(new URLSearchParams(window.location.search).get('tabId'));
    if (pinned) return pinned;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
}
