/**
 * What the toolkit's tools share: the page they work on (followed as you switch tabs or navigate,
 * or the tab named by `?tabId=` when the toolkit is opened in a tab of its own), a `send` bound to
 * that page, and a way to hand off to another tool.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { sendToPage, type MessageType, type Payload, type Reply } from '../../../shared/messages';

export type ToolkitTool = 'recon' | 'lab' | 'api';

export interface ToolkitPageTab {
    tab?: chrome.tabs.Tab;
    url: string;
    title: string;
    host: string;
    favIconUrl?: string;
    /** An http(s) page the tools can work on. */
    web: boolean;
}

type Send = <T extends MessageType>(type: T, payload?: Payload<T>) => Promise<Exclude<Reply<T>, { success: false; error: string }>>;

interface ToolkitContextValue {
    page: ToolkitPageTab;
    send: Send;
    openTool: (tool: ToolkitTool) => void;
    /** Another view of the side panel ("list-extractor"). */
    navigate?: (view: string) => void;
}

const ToolkitContext = createContext<ToolkitContextValue | null>(null);

function describe(tab?: chrome.tabs.Tab): ToolkitPageTab {
    const url = tab?.url ?? '';
    let host = '';
    try { host = new URL(url).host; } catch { /* not a URL yet */ }
    return { tab, url, title: tab?.title ?? '', host, favIconUrl: tab?.favIconUrl, web: /^https?:/.test(url) };
}

/** The page the tools work on, kept current as the user switches tabs or the page navigates. */
export function usePageTab(): ToolkitPageTab {
    const [page, setPage] = useState<ToolkitPageTab>(() => describe());

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

export function ToolkitProvider({ page, openTool, navigate, children }: {
    page: ToolkitPageTab;
    openTool: (tool: ToolkitTool) => void;
    navigate?: (view: string) => void;
    children: ReactNode;
}) {
    const send = useCallback<Send>(
        (type, payload) => (sendToPage as any)(page.tab, type, payload),
        [page.tab],
    );
    const value = useMemo(() => ({ page, send, openTool, navigate }), [page, send, openTool, navigate]);
    return <ToolkitContext.Provider value={value}>{children}</ToolkitContext.Provider>;
}

export function useToolkit(): ToolkitContextValue {
    const ctx = useContext(ToolkitContext);
    if (!ctx) throw new Error('useToolkit outside ToolkitProvider');
    return ctx;
}

/** A URL without its fragment: a report for `/p#reviews` is still the report for `/p`. */
export function samePage(a: string, b: string): boolean {
    return a.split('#')[0] === b.split('#')[0];
}
