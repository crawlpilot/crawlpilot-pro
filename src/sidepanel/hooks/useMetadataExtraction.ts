import { useState, useRef, useCallback, useEffect } from 'react';
import type { MetadataExtractOptions } from '../../shared/types/metadata';
import { hasAllUrlsPermission, requestAllUrlsPermission, openPermissionOnboarding } from '../../shared/utils/hostPermissions';

interface UrlStatus {
    url: string;
    status: 'queued' | 'extracting' | 'done' | 'error';
    error?: string;
}

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
    const [currentJobId, setCurrentJobId] = useState<number | null>(null);

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

        const handleMessage = (message: any) => {
            if (message.type === 'METADATA_EXTRACTION_PROGRESS') {
                const { completedUrls, totalUrls, activeTabs: tabs, urlStatuses: statuses, previewTableId: preview } = message.payload;
                pendingProgressRef.current = {
                    completedUrls, totalUrls, activeTabs: tabs,
                    urlStatuses: statuses || [], previewTableId: preview ?? null
                };
                if (!flushTimerRef.current) {
                    flushTimerRef.current = setTimeout(flushProgress, 300);
                }
            } else if (message.type === 'METADATA_EXTRACTION_COMPLETE') {
                const { tableDataId, stoppedByUser } = message.payload;
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
            }
        };

        chrome.runtime.onMessage.addListener(handleMessage);
        return () => {
            chrome.runtime.onMessage.removeListener(handleMessage);
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
            if (result === 'unavailable') openPermissionOnboarding();
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

        const response = await new Promise<any>((resolve) => {
            chrome.runtime.sendMessage({
                type: 'METADATA_EXTRACTION_START',
                payload: {
                    urls,
                    options,
                    maxConcurrent: Math.min(config.maxConcurrent ?? 3, 5),
                    requestDelay: config.requestDelay ?? 1000,
                    loadTimeout: config.loadTimeout ?? 30000,
                    customName: config.customName,
                },
                timestamp: Date.now(),
            }, (res) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(res);
                }
            });
        });

        if (response?.success && response.jobId) {
            setCurrentJobId(response.jobId);
        } else {
            console.error('[useMetadataExtraction] Failed to start:', response?.error);
            setIsExtracting(false);
        }
    }, []);

    const stopMetadataExtraction = useCallback(() => {
        chrome.runtime.sendMessage({
            type: 'METADATA_EXTRACTION_STOP',
            payload: { jobId: currentJobId },
            timestamp: Date.now(),
        });
        setIsStopping(true);
    }, [currentJobId]);

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
        setCurrentJobId(null);
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
