import { useState, useRef, useEffect, useCallback } from 'react';
import { hasAllUrlsPermission, requestAllUrlsPermission, openSiteAccessSettings } from '../../shared/utils/hostPermissions';

import type { PageVerdict } from '../../shared/verdict/classifyPage';

export interface UrlStatus {
    url: string;
    status: 'queued' | 'extracting' | 'waiting' | 'done' | 'error';
    error?: string;
    verdict?: PageVerdict;
}

interface BulkExtractionOptions {
    maxConcurrent?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    clickWaitMs?: number;
    requestDelay?: number;
    loadTimeout?: number;
    waitForLoad?: boolean;
    enableRandomization?: boolean;
    waitForElements?: boolean;
    elementTimeout?: number;
    /** Minimum gap between two pages of the same site (ms). */
    domainMinGapMs?: number;
    /** Pause and show the tab when a page asks to verify you are human. */
    pauseOnChallenge?: boolean;
    onProgress?: (completed: number) => void;
    onStart?: (jobId: number) => void;
    jobId?: number;
    recipeId?: number;
    customName?: string;
}

export function useBulkExtraction() {
    const [isExtracting, setIsExtracting] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [hasStopped, setHasStopped] = useState(false);
    const [stoppedTableId, setStoppedTableId] = useState<number | null>(null);
    const [hasCompleted, setHasCompleted] = useState(false);
    const [completedTableId, setCompletedTableId] = useState<number | null>(null);
    const [completedPages, setCompletedPages] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [activeTabs, setActiveTabs] = useState(0);
    const [urlStatuses, setUrlStatuses] = useState<UrlStatus[]>([]);
    const [currentJobId, setCurrentJobId] = useState<number | null>(null);
    const [previewTableId, setPreviewTableId] = useState<number | null>(null);
    const [duplicatesRemoved, setDuplicatesRemoved] = useState(0);

    const callbacksRef = useRef<{
        onProgress?: (completed: number) => void;
        onStart?: (jobId: number) => void;
    }>({});

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
            setCompletedPages(p.completedUrls);
            setTotalPages(p.totalUrls);
            setActiveTabs(p.activeTabs);
            setUrlStatuses(p.urlStatuses);
            if (p.previewTableId != null) setPreviewTableId(p.previewTableId);
        };

        const handleMessage = (message: any) => {
            if (message.type === 'BULK_EXTRACTION_PROGRESS') {
                const { completedUrls, totalUrls, activeTabs: tabs, urlStatuses: statuses, previewTableId: preview } = message.payload;
                pendingProgressRef.current = {
                    completedUrls, totalUrls, activeTabs: tabs,
                    urlStatuses: statuses || [], previewTableId: preview ?? null
                };
                if (!flushTimerRef.current) {
                    flushTimerRef.current = setTimeout(flushProgress, 300);
                }
                if (callbacksRef.current.onProgress) {
                    callbacksRef.current.onProgress(completedUrls);
                }
            } else if (message.type === 'BULK_EXTRACTION_COMPLETE') {
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

    const stopBulkExtraction = useCallback(() => {
        chrome.runtime.sendMessage({
            type: 'BULK_EXTRACTION_STOP',
            payload: { jobId: currentJobId },
            timestamp: Date.now()
        });
        setIsStopping(true);
    }, [currentJobId]);

    const startBulkExtraction = useCallback(async (
        urls: string[],
        elements: any[],
        options: BulkExtractionOptions = {}
    ) => {
        const {
            maxConcurrent = 3,
            viewportWidth,
            viewportHeight,
            clickWaitMs,
            requestDelay,
            loadTimeout,
            waitForLoad,
            enableRandomization,
            waitForElements,
            elementTimeout,
            domainMinGapMs,
            pauseOnChallenge,
            onProgress,
            onStart,
            jobId: existingJobId,
            recipeId: passedRecipeId,
            customName
        } = options;

        if (urls.length === 0 || elements.length === 0) return;

        if (!(await hasAllUrlsPermission())) {
            const result = await requestAllUrlsPermission();
            if (result === 'unavailable') openSiteAccessSettings();
            if (result !== 'granted') return;
        }

        callbacksRef.current = { onProgress, onStart };

        setIsExtracting(true);
        setIsStopping(false);
        setHasStopped(false);
        setStoppedTableId(null);
        setHasCompleted(false);
        setCompletedTableId(null);
        setPreviewTableId(null);
        setCompletedPages(0);
        setDuplicatesRemoved(0);
        setTotalPages(urls.length);
        setUrlStatuses(urls.map(url => ({ url, status: 'queued' })));

        const { extraction_settings: settings } = await chrome.storage.local.get(['extraction_settings']) as { extraction_settings?: any };
        const config = settings || { requestDelay: 1000 };
        if (viewportWidth) config.viewportWidth = viewportWidth;
        if (viewportHeight) config.viewportHeight = viewportHeight;
        if (clickWaitMs != null) config.clickWaitMs = clickWaitMs;
        if (requestDelay != null) config.requestDelay = requestDelay;
        if (loadTimeout != null) config.loadTimeout = loadTimeout;
        if (waitForLoad != null) config.waitForLoad = waitForLoad;
        if (enableRandomization != null) config.enableRandomization = enableRandomization;
        if (waitForElements != null) config.waitForElements = waitForElements;
        if (elementTimeout != null) config.elementTimeout = elementTimeout;
        if (domainMinGapMs != null) config.domainMinGapMs = domainMinGapMs;
        if (pauseOnChallenge != null) config.pauseOnChallenge = pauseOnChallenge;

        const response = await new Promise<any>((resolve) => {
            chrome.runtime.sendMessage({
                type: 'BULK_EXTRACTION_START',
                payload: {
                    urls,
                    elements,
                    config,
                    jobId: existingJobId,
                    recipeId: passedRecipeId,
                    customName,
                    maxConcurrent: Math.min(maxConcurrent, 5)
                },
                timestamp: Date.now()
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
            if (onStart) onStart(response.jobId);
            const dupes = (response.originalCount ?? urls.length) - (response.uniqueCount ?? urls.length);
            if (dupes > 0) {
                setDuplicatesRemoved(dupes);
                setTotalPages(response.uniqueCount);
                setUrlStatuses(Array.from(new Set(urls)).map(url => ({ url, status: 'queued' as const })));
            }
        } else {
            console.error('[useBulkExtraction] Failed to start:', response?.error);
            setIsExtracting(false);
        }
    }, []);

    const resetStoppedState = useCallback(() => {
        setHasStopped(false);
        setHasCompleted(false);
        setIsStopping(false);
        setStoppedTableId(null);
        setCompletedTableId(null);
        setCompletedPages(0);
        setUrlStatuses([]);
        setPreviewTableId(null);
        setDuplicatesRemoved(0);
    }, []);

    return {
        isExtracting,
        isStopping,
        hasStopped,
        stoppedTableId,
        hasCompleted,
        completedTableId,
        completedPages,
        totalPages,
        activeTabs,
        urlStatuses,
        previewTableId,
        duplicatesRemoved,
        startBulkExtraction,
        stopBulkExtraction,
        resetStoppedState
    };
}
