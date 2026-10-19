/**
 * The Page assistant's state (docs/plans/summarize-ask-plan.md P1, P3): the model's availability (and
 * its download, which needs a click), language packs (same), the brief of the page's tab, and showing
 * a citation on that page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { modelHost, modelStatus } from '../services/ai/modelHost';
import {
    AssistantError, TranslationNeeded, checkedPage, downloadTranslation, runBrief, showBriefIn, tabPage,
    type AssistantPage, type BriefOutcome,
} from '../services/ai/assistant';
import { BRIEF_SYSTEM, type PageKind } from '../../shared/ai/brief';

export type AssistantPhase = 'starting' | 'needs-model' | 'downloading' | 'needs-translation' | 'briefing' | 'ready' | 'no-model' | 'error';

export interface BriefStatus {
    step: 'reading' | 'translating' | 'briefing' | 'checking';
    part?: number;
    parts?: number;
    kind?: PageKind;
    language?: string;
}

export interface PageAssistantApi {
    phase: AssistantPhase;
    status: BriefStatus | null;
    downloadProgress: number | null;
    outcome: BriefOutcome | null;
    error: string | null;
    /** Why the on-device model can't run here (phase `no-model`). */
    noModelReason: string | null;
    /** The language pack to download (phase `needs-translation`). */
    translation: { source: string; target: string } | null;
    /** The user's language (the extension's language setting). */
    userLang: string;
    /** The tab the brief is about. */
    tabId: number | null;
    /** The page as the brief and answers are checked against it. */
    page: AssistantPage | null;
    download(): void;
    downloadLanguage(): void;
    showInMyLanguage(): void;
    brief(tabId: number): void;
    show(ref: string, quote?: string): void;
}

export function usePageAssistant(initialTabId: number | null): PageAssistantApi {
    const { i18n } = useTranslation();
    const userLang = (i18n.language || 'en').split('-')[0];
    const [phase, setPhase] = useState<AssistantPhase>('starting');
    const [status, setStatus] = useState<BriefStatus | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
    const [outcome, setOutcome] = useState<BriefOutcome | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [noModelReason, setNoModelReason] = useState<string | null>(null);
    const [translation, setTranslation] = useState<{ source: string; target: string } | null>(null);
    const [tabId, setTabId] = useState<number | null>(initialTabId);
    const abort = useRef<AbortController | null>(null);
    const base = tabId === null ? null : tabPage(tabId);
    const page = base && outcome ? checkedPage(outcome, base) : base;

    const run = useCallback(async (id: number) => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setTabId(id);
        setOutcome(null);
        setError(null);
        setPhase('briefing');
        try {
            const result = await runBrief({ page: tabPage(id), userLang, onStatus: setStatus, signal: controller.signal });
            if (controller.signal.aborted) return;
            setOutcome(result);
            setPhase('ready');
        } catch (e) {
            if (controller.signal.aborted) return;
            if (e instanceof AssistantError && e.code === 'needs_activation') { setPhase('needs-model'); return; }
            if (e instanceof TranslationNeeded) { setTranslation({ source: e.source, target: e.target }); setPhase('needs-translation'); return; }
            setError((e as Error).message);
            setPhase('error');
        } finally {
            setStatus(null);
        }
    }, [userLang]);

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

    const downloadLanguage = useCallback(async () => {
        if (tabId === null || !translation) return;
        setPhase('downloading');
        setDownloadProgress(0);
        const ok = await downloadTranslation(translation.source, translation.target, setDownloadProgress);
        setDownloadProgress(null);
        if (!ok) { setError("Chrome can't translate this page's language on this device."); setPhase('error'); return; }
        setTranslation(null);
        void run(tabId);
    }, [tabId, translation, run]);

    const showInMyLanguage = useCallback(async () => {
        if (!outcome?.showInPending) return;
        try {
            setOutcome(await showBriefIn(outcome, outcome.showInPending, setDownloadProgress));
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setDownloadProgress(null);
        }
    }, [outcome]);

    const show = useCallback((ref: string, quote?: string) => {
        page?.show(ref, quote).catch(() => undefined);
    }, [page]);

    return { phase, status, downloadProgress, outcome, error, noModelReason, translation, userLang, tabId, page, download, downloadLanguage, showInMyLanguage, brief, show };
}
