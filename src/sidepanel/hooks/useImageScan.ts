import { useCallback, useEffect, useRef, useState } from 'react';
import { on, sendToTab } from '../../shared/messages';
import type { FoundImage, ImageBatch } from '../../shared/images/types';

async function activeTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
}

/**
 * The page's images: a quick scan when the tool opens, a deep scan (scrolls the page) and a live
 * watch on request. Bound to the tab the scan started in, so switching tabs doesn't mix pages.
 * Batches add images and update known ones (a measured size, a full-size link).
 */
export function useImageScan() {
    const [images, setImages] = useState<FoundImage[]>([]);
    const [scanning, setScanning] = useState<'quick' | 'deep' | null>(null);
    const [progress, setProgress] = useState(0);
    const [liveWatching, setLiveWatching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const bySrc = useRef(new Map<string, FoundImage>());
    const tabRef = useRef<number | null>(null);

    const merge = useCallback((batch: ImageBatch) => {
        for (const img of [...batch.added, ...batch.updated]) bySrc.current.set(img.src, img);
        if (batch.added.length || batch.updated.length) setImages([...bySrc.current.values()].sort((a, b) => a.order - b.order));
    }, []);

    useEffect(() => {
        const fromTab = (sender: chrome.runtime.MessageSender) => sender.tab?.id === tabRef.current && sender.frameId === 0;
        const offs = [
            on('SCAN_IMAGES_BATCH', (batch, sender) => { if (batch && fromTab(sender)) merge(batch); }),
            on('SCAN_IMAGES_PROGRESS', (p, sender) => { if (p && fromTab(sender)) setProgress(p.percent); }),
        ];
        return () => offs.forEach(off => off());
    }, [merge]);

    const quickScan = useCallback(async () => {
        setScanning('quick');
        setError(null);
        bySrc.current.clear();
        setImages([]);
        setLiveWatching(false);
        try {
            const tabId = await activeTabId();
            tabRef.current = tabId ?? null;
            if (!tabId) return;
            const response = await sendToTab(tabId, 'SCAN_IMAGES');
            if (response.success) merge({ added: response.images, updated: [] });
            else setError(response.error);
        } catch (e) {
            setError((e as Error)?.message || String(e));
        } finally {
            setScanning(null);
        }
    }, [merge]);

    const deepScan = useCallback(async () => {
        const tabId = tabRef.current;
        if (!tabId) return;
        setScanning('deep');
        setProgress(0);
        setError(null);
        try {
            const response = await sendToTab(tabId, 'SCAN_IMAGES_DEEP');
            if (response.success) merge({ added: response.images, updated: [] });
            else setError(response.error);
        } catch (e) {
            setError((e as Error)?.message || String(e));
        } finally {
            setScanning(null);
            setProgress(100);
        }
    }, [merge]);

    const cancelScan = useCallback(async () => {
        if (tabRef.current) await sendToTab(tabRef.current, 'SCAN_IMAGES_CANCEL').catch(() => undefined);
    }, []);

    const toggleLiveWatch = useCallback(async () => {
        const tabId = tabRef.current;
        if (!tabId) return;
        if (liveWatching) {
            await sendToTab(tabId, 'SCAN_IMAGES_LIVE_STOP').catch(() => undefined);
            setLiveWatching(false);
        } else {
            setLiveWatching(true);
            await sendToTab(tabId, 'SCAN_IMAGES_LIVE_START').catch(() => setLiveWatching(false));
        }
    }, [liveWatching]);

    return { images, scanning, progress, liveWatching, error, quickScan, deepScan, cancelScan, toggleLiveWatch };
}
