import { useState, useCallback } from 'react';
import { sendToTab, type PickerAdjust } from '../../shared/messages';
import { pageTabId } from './usePageTab';

export function useSelectionMode() {
    const [status, setStatus] = useState<'idle' | 'selecting' | 'ready'>('idle');
    const [selectingFor, setSelectingFor] = useState<'list' | 'nextButton' | 'detail'>('list');
    const [error, setError] = useState<string | null>(null);

    /** `adjust`: open on a picked field or list instead of a fresh pick (plan L6). */
    const startSelection = useCallback(async (mode: 'list' | 'nextButton' | 'detail', action: 'extract' | 'click' = 'extract', adjust?: PickerAdjust) => {
        setStatus('selecting');
        setSelectingFor(mode);
        setError(null);

        try {
            const tabId = await pageTabId();
            if (!tabId) throw new Error('No active tab found');

            let res;
            try {
                res = await sendToTab(tabId, 'START_PICKER', {
                    mode: mode === 'nextButton' ? 'single' : mode,
                    action: mode === 'nextButton' ? 'click' : action,
                    ...(adjust ? { adjust } : {}),
                });
            } catch (e) {
                // Content script is not active. This usually happens on restricted pages (like chrome://) 
                // or if the page was loaded before the extension.
                throw new Error('Selection tool is not active on this page. Please try refreshing the page or try a different website.');
            }
            if (res && !res.success) throw new Error(res.error);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start selection');
            setStatus('idle');
        }
    }, []);

    const stopSelection = useCallback(async () => {
        try {
            const tabId = await pageTabId();
            if (tabId) await sendToTab(tabId, 'STOP_PICKER');
        } catch (e) {
            console.warn('Failed to stop picker:', e);
        } finally {
            setStatus('idle');
        }
    }, []);

    return {
        status,
        setStatus,
        selectingFor,
        error,
        startSelection,
        stopSelection
    };
}
