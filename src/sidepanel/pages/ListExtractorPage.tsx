import { useEffect, useRef, useState } from 'react';
import { on, sendToTab } from '../../shared/messages';
import { useTranslation } from 'react-i18next';
import { useSelectorManager } from '../hooks/useSelectorManager';
import { useSelectionMode } from '../hooks/useSelectionMode';
import { currentListRun, useExtractionProcess } from '../hooks/useExtractionProcess';
import type { ListPick, PaginationMode } from '../../shared/types/extraction';
import type { UrlPages } from '../../shared/listing/urlPages';
import { db } from '../../shared/db';
import { WizardLayout } from '../components/wizard/WizardLayout';
import { QuickRun } from '../components/list-extractor/QuickRun';
import { Step1Selection } from '../components/list-extractor/wizard/Step1Selection';
import { Step2Navigation } from '../components/list-extractor/wizard/Step2Navigation';
import { Step3Review } from '../components/list-extractor/wizard/Step3Review';
import { PaginationSpeed, DEFAULT_PAGINATION_SPEED } from '../../shared/constants/paginationConfig';
import { consolidateSelectors } from '../../shared/utils/extractionLogic';
import { itemUrlColumn, itemUrls } from '../../shared/listing/join';
import { setDetailsDraft } from '../services/detailsDraft';
import { siteOf } from '../../shared/sites/siteSettings';

interface ListExtractorPageProps {
    onBack?: () => void;
    onNavigate?: (view: string) => void;
}

export default function ListExtractorPage({ onBack, onNavigate }: ListExtractorPageProps) {
    const { t } = useTranslation('listExtractor');
    // A run started here (or re-run from History) goes on while the panel shows other screens: back
    // here, the page opens on its progress (or its result) with the picks it runs with.
    const [resumed] = useState(() => {
        const run = currentListRun();
        return run.status.status !== 'idle' && run.picks.length ? run : null;
    });
    // 1. Logic Hooks
    const {
        selectors,
        next,
        setNext,
        addSelector,
        removeSelector,
        updateSelector
    } = useSelectorManager(resumed ? { selectors: resumed.picks, next: resumed.pagination?.next ?? [] } : undefined);

    const {
        status: selectionStatus,
        setStatus: setSelectionStatus,
        selectingFor,
        startSelection,
        stopSelection
    } = useSelectionMode();

    const {
        status: extractionStatus,
        startExtraction,
        stopExtraction,
        reset
    } = useExtractionProcess(); // Removed callback to stop auto-opening results

    // 2. Wizard State
    const [step, setStep] = useState(resumed ? 3 : 1);
    const [paginationMode, setPaginationMode] = useState<PaginationMode>(resumed?.pagination?.mode ?? 'auto');
    const [speed, setSpeed] = useState<PaginationSpeed>(resumed?.pagination?.speed ?? DEFAULT_PAGINATION_SPEED);
    const [maxPages, setMaxPages] = useState<number>(resumed?.pagination?.maxPages ?? 3);
    const [previewTableId, setPreviewTableId] = useState<number | null>(null);
    // How more items load, found on the page after the first pick (undefined: still looking; null: none).
    const [pages, setPages] = useState<{ mode: PaginationMode; label: string } | null | undefined>(undefined);
    /** The numbered pages' address pattern, when the Next link has one: the run reads pages by address. */
    const [urlPattern, setUrlPattern] = useState<UrlPages | null>(resumed?.pagination?.pages ?? null);
    // Once the user sets pagination in the Pages step, the found control no longer overrides it.
    const userSetPages = useRef(false);
    const choosePaginationMode = (mode: PaginationMode) => { userSetPages.current = true; setPaginationMode(mode); };
    const chooseNext = (selectors: string[]) => { userSetPages.current = true; setNext(selectors); };

    /** The list being adjusted (plan L6): the next pick replaces it in place. */
    const adjustingRef = useRef<string | null>(null);
    const [adjustError, setAdjustError] = useState<string | null>(null);
    const adjustSelector = async (id: string) => {
        const pick = selectors.find(s => s.id === id);
        if (!pick) return;
        setAdjustError(null);
        adjustingRef.current = id;
        const started = await startSelection('list', 'extract', { chain: pick.container, items: pick.items });
        if (!started) { adjustingRef.current = null; setAdjustError('This list is no longer on the page: pick it again.'); }
    };

    // 3. Message Listener (The Bridge)
    useEffect(() => {
        const offSelected = on('ELEMENT_SELECTED', (selected, sender) => {
            const payload = selected;
            const tabId = sender.tab?.id;

            if (payload.success) {
                const isNextButton = selectingFor === 'nextButton';

                if (isNextButton) {
                    userSetPages.current = true;
                    setNext(payload.selectors ?? []);
                    setSelectionStatus('ready');
                } else {
                    const adjusting = adjustingRef.current;
                    adjustingRef.current = null;
                    const pick: ListPick = {
                        id: adjusting ?? Date.now().toString(),
                        container: payload.container ?? [],
                        items: payload.items ?? [],
                        count: payload.count || 1,
                        data: payload.data,
                        patternFound: payload.patternFound || false,
                        sourceTabId: tabId,
                        label: payload.label,
                        kind: payload.kind,
                    };
                    // Adjusted: the list keeps its place; its section, items and fields are the new pick.
                    const others = adjusting ? selectors.map(s => s.id === adjusting ? pick : s) : [...selectors, pick];
                    if (adjusting) updateSelector(adjusting, pick);
                    else addSelector(pick);
                    setSelectionStatus('ready');

                    // The first list: find its Next or "Load more" control, so it can run in one click.
                    if (!adjusting && selectors.length === 0 && tabId) {
                        setPages(undefined);
                        sendToTab(tabId, 'FIND_NEXT')
                            .then(res => {
                                const control = res && 'control' in res ? res.control : null;
                                const byAddress = control?.mode === 'pagination' && control.pages ? control.pages : null;
                                setPages(control ? { mode: byAddress ? 'urls' : control.mode, label: control.label } : null);
                                setUrlPattern(byAddress);
                                if (userSetPages.current) return;
                                setPaginationMode(control ? (byAddress ? 'urls' : control.mode) : 'auto');
                                setNext(control ? control.selectors : []);
                            })
                            .catch(() => setPages(null));
                    }

                    // Save preview data
                    if (payload.data && payload.data.items && payload.data.items.length > 0) {
                        (async () => {
                            try {
                                // Use sender.tab — this is the actual page the user picked from,
                                // not whatever tab happens to be active in the window right now.
                                const sourceTabInfo = sender.tab;
                                const pageTitle = sourceTabInfo?.title
                                    || (sourceTabInfo?.url ? new URL(sourceTabInfo.url).hostname : null)
                                    || new URL(payload.data.source_url || window.location.href).hostname;

                                // The preview covers every pick so far, the new one included.
                                const previewData = consolidateSelectors(others, sourceTabInfo?.url);

                                // Pass the existing previewTableId so we UPDATE the same record
                                // instead of creating a new one each time the user picks elements.
                                const tableId = await db.tables.save(previewData, {
                                    name: pageTitle,
                                    preview: true,
                                    tableId: previewTableId || undefined,
                                    replace: !!previewTableId
                                });
                                setPreviewTableId(tableId);
                            } catch (e) {
                                console.error('Failed to save preview', e);
                            }
                        })();
                    }
                }
            } else {
                setSelectionStatus('idle');
            }
        });
        const offCancelled = on('PICKER_CANCELLED', () => {
            adjustingRef.current = null;
            if (selectors.length === 0 && selectingFor === 'list') setSelectionStatus('idle');
            else setSelectionStatus('ready');
        });

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                stopSelection();
            }
        };
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            offSelected();
            offCancelled();
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [selectingFor, selectors, addSelector, updateSelector, setNext, setSelectionStatus, stopSelection]);

    /** The list's site (its settings show before the run): the page the list was picked on. */
    const [site, setSite] = useState('');
    const sourceTabId = selectors[0]?.sourceTabId;
    useEffect(() => {
        if (sourceTabId === undefined) return;
        chrome.tabs.get(sourceTabId).then(tab => setSite(siteOf(tab.url)), () => setSite(''));
    }, [sourceTabId]);

    /** List + details: the list's item links go to the Page Extractor, whose fields join onto this list. */
    const [detailsError, setDetailsError] = useState<string | null>(null);
    const addDetails = async () => {
        const tableId = extractionStatus.tableId;
        if (!tableId) return;
        setDetailsError(null);
        const table = await db.tables.get(tableId);
        if (!table) return;
        const rows = (await db.tables.rowsPage(tableId, 0, Math.max(table.rowCount, 1))).map(r => r.data);
        const urlColumn = itemUrlColumn(table.columns, rows);
        if (!urlColumn) { setDetailsError(t('step3.detailsNoLinks')); return; }
        setDetailsDraft({ tableId, urlColumn, urls: itemUrls(rows, urlColumn), listName: table.name });
        reset();
        onNavigate?.('page-extractor');
    };

    // Handlers
    const handleVerifySelector = async (selector: string) => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) void sendToTab(tab.id, 'TEST_SELECTOR', { selector }).catch(() => { /* not connected */ });
    };

    const handleStart = () => {
        startExtraction(selectors, {
            mode: paginationMode,
            next,
            speed,
            maxPages,
            ...(paginationMode === 'urls' && urlPattern ? { pages: urlPattern } : {}),
        }, { tableId: previewTableId || undefined });

        // Reset preview ID so subsequent runs create new datasets
        setPreviewTableId(null);
    };

    // Render Wizard Step
    const renderStep = () => {
        switch (step) {
            case 1:
                return (
                    <Step1Selection
                        selectors={selectors}
                        selectionStatus={selectionStatus}
                        selectingFor={selectingFor}
                        onStartSelection={() => startSelection('list')}
                        onRemoveSelector={removeSelector}
                        onAdjustSelector={id => void adjustSelector(id)}
                        adjustError={adjustError}
                        onUpdateSelector={updateSelector}
                        onTestSelector={handleVerifySelector}
                        onNext={() => setStep(2)}
                        onCancel={stopSelection}
                        quickRun={selectors[0] && (
                            <QuickRun
                                pick={selectors[0]}
                                pages={pages}
                                maxPages={maxPages}
                                onMaxPages={setMaxPages}
                                onRun={() => { handleStart(); setStep(3); }}
                                onCustomize={() => setStep(2)}
                                onOpenPreview={previewTableId ? () => chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${previewTableId}`) }) : undefined}
                                busy={selectionStatus === 'selecting'}
                            />
                        )}
                    />
                );
            case 2:
                return (
                    <Step2Navigation
                        byAddress={!!urlPattern}
                        paginationMode={paginationMode}
                        setPaginationMode={choosePaginationMode}
                        next={next}
                        selectingFor={selectionStatus === 'selecting' && selectingFor === 'nextButton' ? 'nextButton' : null}
                        onStartSelection={() => startSelection('nextButton')}
                        onRemoveNextButton={() => chooseNext([])}
                        onUpdateNextButton={chooseNext}
                        onTestSelector={handleVerifySelector}
                        onNext={() => setStep(3)}
                        onBack={() => setStep(1)}
                        onCancel={stopSelection}
                    />
                );
            case 3:
                return (
                    <Step3Review
                        selectors={selectors}
                        paginationMode={paginationMode}
                        status={extractionStatus}
                        isExtracting={extractionStatus.isExtracting}
                        onStart={handleStart}
                        onStop={stopExtraction}
                        onReset={() => {
                            reset();
                            if (onBack) onBack(); // Redirect to home
                        }}
                        onBack={() => {
                            reset();
                            setStep(2);
                        }}
                        speed={speed}
                        onSpeedChange={setSpeed}
                        maxPages={maxPages}
                        onMaxPagesChange={setMaxPages}
                        onAddDetails={onNavigate ? () => void addDetails() : undefined}
                        site={site}
                        detailsError={detailsError}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <WizardLayout
            title={t('title')}
            subtitle={step === 1 ? t('step1.subtitle') : step === 2 ? t('step2.subtitle') : t('step3.subtitle')}
            currentStep={step}
            totalSteps={3}
            stepLabels={t('stepLabels', { returnObjects: true }) as string[]}
            onBack={step === 1 ? onBack : () => setStep(step - 1)}
        >
            {renderStep()}
        </WizardLayout>
    );
}
