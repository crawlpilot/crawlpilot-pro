import { useState, useRef, useCallback, useEffect } from 'react';
import { on, send, UrlStatus } from '../../shared/messages';
import type { MetadataExtractOptions } from '../../shared/types/metadata';
import { hasAllUrlsPermission, requestAllUrlsPermission, openSiteAccessSettings } from '../../shared/utils/hostPermissions';

export function useMetadataExtraction() {
    const [isExtracting, setIsExtracting] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [hasStopped, setHasStopped] = useState(false);
    const [hasCompleted, setHasCompleted] = useState(false);
    const [completedTableId, setCompletedTableId] = useState<number | null>(null);
    const [stoppedTableId, setStoppedTableId] = useState<number | null>(null);
    const [completedCount, setCompletedCount] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [activeTabs, setActiveTabs] = useState(0);
    const [urlStatuses, setUrlStatuses] = useState<UrlStatus[]>([]);
    const [previewTableId, setPreviewTableId] = useState<number | null>(null);

    const pendingProgressRef = useRef<{
        completedUrls: number; totalUrls: number; activeTabs: number;
        urlStatuses: UrlStatus[]; previewTableId: number | null;
    } | null>(null);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const flushProgress = () => {
            flushTimerRef.current = null;
            const p = pendingProgressRef.current;
            if (!p) return;
            pendingProgressRef.current = null;
            setCompletedCount(p.completedUrls);
            setTotalCount(p.totalUrls);
            setActiveTabs(p.activeTabs);
            setUrlStatuses(p.urlStatuses);
            if (p.previewTableId != null) setPreviewTableId(p.previewTableId);
        };

        const offs = [
            on('METADATA_EXTRACTION_PROGRESS', payload => {
                const { completedUrls, totalUrls, activeTabs: tabs, urlStatuses: statuses, previewTableId: preview } = payload;
                pendingProgressRef.current = {
                    completedUrls, totalUrls, activeTabs: tabs,
                    urlStatuses: statuses || [], previewTableId: preview ?? null
                };
                if (!flushTimerRef.current) {
                    flushTimerRef.current = setTimeout(flushProgress, 300);
                }
            }),
            on('METADATA_EXTRACTION_COMPLETE', payload => {
                const { tableDataId, stoppedByUser } = payload;
                setIsExtracting(false);
                setIsStopping(false);
                setActiveTabs(0);
                if (stoppedByUser) {
                    setHasStopped(true);
                    setStoppedTableId(tableDataId ?? null);
                } else {
                    setHasCompleted(true);
                    setCompletedTableId(tableDataId ?? null);
                }
            }),
        ];

        return () => {
            offs.forEach(off => off());
            if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        };
    }, []);

    const startMetadataExtraction = useCallback(async (
        urls: string[],
        options: MetadataExtractOptions = {},
        config: { maxConcurrent?: number; requestDelay?: number; loadTimeout?: number; customName?: string } = {}
    ) => {
        if (urls.length === 0) return;

        if (!(await hasAllUrlsPermission())) {
            const result = await requestAllUrlsPermission();
            if (result === 'unavailable') openSiteAccessSettings();
            if (result !== 'granted') return;
        }

        setIsExtracting(true);
        setIsStopping(false);
        setHasStopped(false);
        setHasCompleted(false);
        setStoppedTableId(null);
        setCompletedTableId(null);
        setPreviewTableId(null);
        setCompletedCount(0);
        setTotalCount(urls.length);
        setUrlStatuses(urls.map(url => ({ url, status: 'queued' as const })));

        const response = await send('METADATA_EXTRACTION_START', {
            urls,
            options,
            maxConcurrent: Math.min(config.maxConcurrent ?? 3, 5),
            requestDelay: config.requestDelay ?? 1000,
            loadTimeout: config.loadTimeout ?? 30000,
            customName: config.customName,
        });

        if (response?.success) {
        } else {
            console.error('[useMetadataExtraction] Failed to start:', response?.error ?? 'background not reachable');
            setIsExtracting(false);
        }
    }, []);

    const stopMetadataExtraction = useCallback(() => {
        void send('METADATA_EXTRACTION_STOP');
        setIsStopping(true);
    }, []);

    const resetState = useCallback(() => {
        setHasStopped(false);
        setHasCompleted(false);
        setIsStopping(false);
        setStoppedTableId(null);
        setCompletedTableId(null);
        setCompletedCount(0);
        setTotalCount(0);
        setUrlStatuses([]);
        setPreviewTableId(null);
    }, []);

    return {
        isExtracting,
        isStopping,
        hasStopped,
        hasCompleted,
        completedTableId,
        stoppedTableId,
        completedCount,
        totalCount,
        activeTabs,
        urlStatuses,
        previewTableId,
        startMetadataExtraction,
        stopMetadataExtraction,
        resetState,
    };
}
