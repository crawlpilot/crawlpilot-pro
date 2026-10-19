/**
 * What the toolkit's tools share: the page they work on (followed as you switch tabs or navigate,
 * or the tab named by `?tabId=` when the toolkit is opened in a tab of its own), a `send` bound to
 * that page, and a way to hand off to another tool.
 */
import { createContext, ReactNode, useCallback, useContext, useMemo } from 'react';
import type { PageTab } from '../../hooks/usePageTab';
export { usePageTab } from '../../hooks/usePageTab';
import { sendToPage, type MessageType, type Payload, type Reply } from '../../../shared/messages';

export type ToolkitTool = 'recon' | 'lab' | 'api' | 'data';

export type ToolkitPageTab = PageTab;

type Send = <T extends MessageType>(type: T, payload?: Payload<T>) => Promise<Exclude<Reply<T>, { success: false; error: string }>>;

interface ToolkitContextValue {
    page: ToolkitPageTab;
    send: Send;
    openTool: (tool: ToolkitTool) => void;
    /** Another view of the side panel ("list-extractor"). */
    navigate?: (view: string) => void;
}

const ToolkitContext = createContext<ToolkitContextValue | null>(null);

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
