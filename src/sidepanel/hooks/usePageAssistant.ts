/**
 * The Page assistant's state (docs/plans/summarize-ask-plan.md P1): the model's availability (and its
 * download, which needs a click), the brief of the page's tab, and showing a citation on that page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { modelHost, modelStatus } from '../services/ai/modelHost';
import { AssistantError, runBrief, tabPage, type AssistantPage, type BriefOutcome } from '../services/ai/assistant';
import { BRIEF_SYSTEM, type PageKind } from '../../shared/ai/brief';

export type AssistantPhase = 'starting' | 'needs-model' | 'downloading' | 'briefing' | 'ready' | 'no-model' | 'error';

export interface BriefStatus {
    step: 'reading' | 'briefing' | 'checking';
    part?: number;
    parts?: number;
    kind?: PageKind;
}

export interface PageAssistantApi {
    phase: AssistantPhase;
    status: BriefStatus | null;
    downloadProgress: number | null;
    outcome: BriefOutcome | null;
    error: string | null;
    /** Why the on-device model can't run here (phase `no-model`). */
    noModelReason: string | null;
    /** The tab the brief is about. */
    tabId: number | null;
    page: AssistantPage | null;
    download(): void;
    brief(tabId: number): void;
    show(ref: string, quote?: string): void;
}

export function usePageAssistant(initialTabId: number | null): PageAssistantApi {
    const [phase, setPhase] = useState<AssistantPhase>('starting');
    const [status, setStatus] = useState<BriefStatus | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
    const [outcome, setOutcome] = useState<BriefOutcome | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [noModelReason, setNoModelReason] = useState<string | null>(null);
    const [tabId, setTabId] = useState<number | null>(initialTabId);
    const abort = useRef<AbortController | null>(null);
    const page = tabId === null ? null : tabPage(tabId);

    const run = useCallback(async (id: number) => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setTabId(id);
        setOutcome(null);
        setError(null);
        setPhase('briefing');
        try {
            const result = await runBrief({ page: tabPage(id), onStatus: setStatus, signal: controller.signal });
            if (controller.signal.aborted) return;
            setOutcome(result);
            setPhase('ready');
        } catch (e) {
            if (controller.signal.aborted) return;
            if (e instanceof AssistantError && e.code === 'needs_activation') { setPhase('needs-model'); return; }
            setError((e as Error).message);
            setPhase('error');
        } finally {
            setStatus(null);
        }
    }, []);

    const brief = useCallback(async (id: number) => {
        setPhase('starting');
        const model = await modelStatus();
        if (model.availability === 'unavailable') {
            setNoModelReason(model.reason ?? null);
            setTabId(id);
            setPhase('no-model');
            return;
        }
        // A download needs a click (user activation): the screen shows the button.
        if (model.availability !== 'available' && !navigator.userActivation?.isActive) {
            setTabId(id);
            setPhase('needs-model');
            return;
        }
        void run(id);
    }, [run]);

    useEffect(() => {
        if (initialTabId !== null) void brief(initialTabId);
        return () => abort.current?.abort();
    }, [initialTabId, brief]);

    const download = useCallback(async () => {
        if (tabId === null) return;
        setPhase('downloading');
        setDownloadProgress(0);
        const prepared = await modelHost.prepare(BRIEF_SYSTEM, 'exact', setDownloadProgress);
        setDownloadProgress(null);
        if (!prepared.ok) {
            setError(new AssistantError(prepared.code, prepared.detail).message);
            setPhase('error');
            return;
        }
        void run(tabId);
    }, [tabId, run]);

    const show = useCallback((ref: string, quote?: string) => {
        page?.show(ref, quote).catch(() => undefined);
    }, [page]);

    return { phase, status, downloadProgress, outcome, error, noModelReason, tabId, page, download, brief, show };
}
