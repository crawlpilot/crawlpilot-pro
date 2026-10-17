import { useState, useCallback } from 'react';
import { sendToTab } from '../../shared/messages';

export function useSelectionMode() {
    const [status, setStatus] = useState<'idle' | 'selecting' | 'ready'>('idle');
    const [selectingFor, setSelectingFor] = useState<'list' | 'nextButton' | 'detail'>('list');
    const [error, setError] = useState<string | null>(null);

    const startSelection = useCallback(async (mode: 'list' | 'nextButton' | 'detail', action: 'extract' | 'click' = 'extract') => {
        setStatus('selecting');
        setSelectingFor(mode);
        setError(null);

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab.id) throw new Error('No active tab found');

            try {
                await sendToTab(tab.id, 'START_PICKER', {
                    mode: mode === 'nextButton' ? 'single' : mode,
                    action: mode === 'nextButton' ? 'click' : action
                });
            } catch (e) {
                // Content script is not active. This usually happens on restricted pages (like chrome://) 
                // or if the page was loaded before the extension.
                throw new Error('Selection tool is not active on this page. Please try refreshing the page or try a different website.');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start selection');
            setStatus('idle');
        }
    }, []);

    const stopSelection = useCallback(async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                await sendToTab(tab.id, 'STOP_PICKER');
            }
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
