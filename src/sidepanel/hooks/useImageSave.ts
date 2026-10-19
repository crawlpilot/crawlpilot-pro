import { useCallback, useRef, useState } from 'react';
import type { FoundImage } from '../../shared/images/types';
import { NAMING_PRESETS } from '../services/images/naming';
import { browserDeps, defaultMode, saveImages, type SaveMode, type SaveProgress, type SaveReport } from '../services/images/save';

const MODE_KEY = 'crawlpilot.images.mode';
const TEMPLATE_KEY = 'crawlpilot.images.template';

function stored<T extends string>(key: string, fallback: T): T {
    try { return (localStorage.getItem(key) as T) || fallback; } catch { return fallback; }
}

function store(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

/** Saving images from the Image Downloader: options (kept between visits), progress, the report, retrying failures. */
export function useImageSave(tabId: number | null, pageTitle: string) {
    const [mode, setModeState] = useState<SaveMode | 'auto'>(() => stored(MODE_KEY, 'auto'));
    const [template, setTemplateState] = useState<string>(() => stored(TEMPLATE_KEY, NAMING_PRESETS.original.template));
    const [progress, setProgress] = useState<SaveProgress | null>(null);
    const [report, setReport] = useState<SaveReport | null>(null);
    const lastRun = useRef<FoundImage[]>([]);
    const abortRef = useRef<AbortController | null>(null);

    const setMode = (m: SaveMode | 'auto') => { setModeState(m); store(MODE_KEY, m); };
    const setTemplate = (t: string) => { setTemplateState(t); store(TEMPLATE_KEY, t); };

    const save = useCallback(async (images: FoundImage[], forced?: SaveMode) => {
        if (!images.length || abortRef.current) return;
        const controller = new AbortController();
        abortRef.current = controller;
        lastRun.current = images;
        setReport(null);
        setProgress({ done: 0, failed: 0, total: images.length, bytes: 0 });
        try {
            const result = await saveImages(images, {
                mode: forced ?? (mode === 'auto' ? defaultMode(images.length) : mode),
                template: template.trim() || NAMING_PRESETS.original.template,
                pageTitle,
                signal: controller.signal,
                onProgress: setProgress,
            }, browserDeps(tabId));
            setReport(result);
        } finally {
            abortRef.current = null;
            setProgress(null);
        }
    }, [mode, template, pageTitle, tabId]);

    const retryFailed = useCallback(() => {
        if (!report) return;
        const failed = new Set(report.failures.map(f => f.src));
        void save(lastRun.current.filter(i => failed.has(i.src)));
    }, [report, save]);

    const stop = useCallback(() => abortRef.current?.abort(), []);
    const dismiss = useCallback(() => setReport(null), []);

    return { mode, setMode, template, setTemplate, progress, report, save, retryFailed, stop, dismiss };
}
