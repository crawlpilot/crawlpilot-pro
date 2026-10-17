import { useCallback, useEffect, useRef, useState } from 'react';
import { on, sendToTab } from '../../shared/messages';
import type { ImageMeta } from '../../content/features/universal-images/ImageScanner';

async function activeTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
}

/** The active page's images: a deep scan (scrolls the page) and a live watch, merged by URL as batches arrive. */
export function useImageScan() {
    const [images, setImages] = useState<ImageMeta[]>([]);
    const [scanning, setScanning] = useState(false);
    const [scanPhase, setScanPhase] = useState('');
    const [scanProgress, setScanProgress] = useState(0);
    const [liveWatching, setLiveWatching] = useState(false);
    const bySrc = useRef(new Map<string, ImageMeta>());

    const merge = useCallback((batch: ImageMeta[]) => {
        let changed = false;
        for (const img of batch) {
            if (!bySrc.current.has(img.src)) {
                bySrc.current.set(img.src, img);
                changed = true;
            }
        }
        if (changed) setImages(Array.from(bySrc.current.values()));
    }, []);

    useEffect(() => {
        const offs = [
            on('SCAN_IMAGES_BATCH', batch => { if (batch) merge(batch); }),
            on('SCAN_IMAGES_PROGRESS', progress => {
                if (!progress) return;
                setScanPhase(progress.phase || '');
                setScanProgress(progress.scrollPercent || 0);
            }),
        ];
        return () => offs.forEach(off => off());
    }, [merge]);

    const deepScan = useCallback(async () => {
        setScanning(true);
        setScanProgress(0);
        setScanPhase('starting');
        bySrc.current.clear();
        setImages([]);
        try {
            const tabId = await activeTabId();
            if (tabId) {
                const response = await sendToTab(tabId, 'SCAN_IMAGES_DEEP', { scrollStep: 800, scrollDelay: 120, maxScrollHeight: 50000, watchDuration: 3000 });
                if (response.success && response.data) merge(response.data);
            }
        } catch (error) {
            console.error('Deep scan failed:', error);
        } finally {
            setScanning(false);
            setScanPhase('complete');
            setScanProgress(100);
        }
    }, [merge]);

    const cancelScan = useCallback(async () => {
        const tabId = await activeTabId();
        if (tabId) await sendToTab(tabId, 'SCAN_IMAGES_DEEP_CANCEL').catch(() => undefined);
    }, []);

    const toggleLiveWatch = useCallback(async () => {
        const tabId = await activeTabId();
        if (!tabId) return;
        if (liveWatching) {
            await sendToTab(tabId, 'SCAN_IMAGES_LIVE_STOP');
            setLiveWatching(false);
        } else {
            setLiveWatching(true);
            await sendToTab(tabId, 'SCAN_IMAGES_LIVE_START');
        }
    }, [liveWatching]);

    return { images, scanning, scanPhase, scanProgress, liveWatching, deepScan, cancelScan, toggleLiveWatch };
}
