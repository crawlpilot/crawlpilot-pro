import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WizardLayout } from '../components/wizard/WizardLayout';
import { Step2SummaryChat } from '../components/summarizer/wizard/Step2SummaryChat';
import { PageAssistant } from '../components/summarizer/PageAssistant';
import { Notice, Segmented, Spinner, Text } from '../ui';
import { extractActiveTabContent } from '../services/extraction/pageContent';
import type { ExtractedContent } from '@/shared/types/summarizer';

interface TextSummarizerPageProps {
    onBack?: () => void;
    /** Opens another tool (a brief's next step: the List Extractor, AI Extract). */
    onNavigate?: (view: string) => void;
}

/** The plain summary (Chrome's Summarizer API, with chat): the page read with Readability first. */
function SummaryMode({ onBack }: { onBack?: () => void }) {
    const { t } = useTranslation('summarizer');
    const [doc, setDoc] = useState<ExtractedContent | null>(null);
    const [isExtracting, setIsExtracting] = useState(true);

    useEffect(() => {
        let isMounted = true;
        extractActiveTabContent()
            .then(content => { if (isMounted) setDoc(content); })
            .finally(() => { if (isMounted) setIsExtracting(false); });
        return () => { isMounted = false; };
    }, []);

    if (isExtracting) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-ink-2">
                <Spinner size={32} />
                <Text tone="muted">{t('readingPage')}</Text>
            </div>
        );
    }
    if (!doc) return <div className="flex flex-col items-center justify-center p-12"><Text tone="muted">{t('noTextFound')}</Text></div>;
    return <Step2SummaryChat doc={doc} onBack={onBack || (() => {})} />;
}

/**
 * The Page assistant (docs/plans/summarize-ask-plan.md): a brief of the page with checked citations
 * and questions (the default), or a plain summary.
 */
export default function TextSummarizerPage({ onBack, onNavigate }: TextSummarizerPageProps) {
    const { t } = useTranslation('summarizer');
    const [mode, setMode] = useState<'brief' | 'summary'>('brief');
    const [tabId, setTabId] = useState<number | null | undefined>(undefined);

    // The page it works on: `?tabId=` when opened in a tab of its own, else the active tab.
    useEffect(() => {
        const pinned = Number(new URLSearchParams(window.location.search).get('tabId')) || null;
        if (pinned) { setTabId(pinned); return; }
        chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setTabId(tab?.id && /^https?:/.test(tab.url ?? '') ? tab.id : null), () => setTabId(null));
    }, []);

    return (
        <WizardLayout title={t('title')} subtitle={t('subtitle')} currentStep={1} totalSteps={1} onBack={onBack}>
            <div className="flex h-full flex-col gap-3">
                <Segmented size="sm" fullWidth aria-label="Mode" value={mode} onChange={setMode}
                    options={[{ value: 'brief', label: 'Brief' }, { value: 'summary', label: 'Summary' }]} />
                {tabId === undefined ? null : tabId === null ? (
                    <Notice tone="info">Open a web page (http or https) to use the Page assistant on it.</Notice>
                ) : (
                    <>
                        {/* Kept while the summary shows: back to the brief costs no new model run. */}
                        <div hidden={mode !== 'brief'}><PageAssistant initialTabId={tabId} onSummary={() => setMode('summary')} onNavigate={onNavigate} /></div>
                        {mode === 'summary' && <SummaryMode onBack={onBack} />}
                    </>
                )}
            </div>
        </WizardLayout>
    );
}
