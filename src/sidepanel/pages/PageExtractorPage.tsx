import { useState, useEffect, useRef, useCallback } from 'react';
import { highlightOnActiveTab, on } from '../../shared/messages';
import { useTranslation } from 'react-i18next';
import DataSourceSelector from '../components/DataSourceSelector';
import { useSelectionMode } from '../hooks/useSelectionMode';
import { useBulkExtraction } from '../hooks/useBulkExtraction';
import { WizardLayout } from '../components/wizard/WizardLayout';

import { Step1Urls } from '../components/page-extractor/wizard/Step1Urls';
import { Step2Schema } from '../components/page-extractor/wizard/Step2Schema';
import { Step3Review } from '../components/page-extractor/wizard/Step3Review';
import { DetailsChoice } from '../components/page-extractor/wizard/DetailsChoice';
import { MetadataStep2Run } from '../components/metadata-extractor/MetadataStep2Run';
import { useMetadataExtraction } from '../hooks/useMetadataExtraction';
import type { MetadataExtractOptions } from '../../shared/types/metadata';
import { pageTabId } from '../hooks/usePageTab';
import { defaultConcurrency } from '@/shared/utils/concurrency';
import { takeDetailsDraft, type DetailsDraft } from '../services/detailsDraft';
import { takePageDataDraft } from '../services/pageDataDraft';
import { Notice } from '../ui';
import { pageEditInput, takeProEdit, type ProEdit } from '../../pro/edit';
import { PageSave } from '../../pro/pages/ExtractorSave';

interface PageExtractorPageProps {
    onBack: () => void;
    /**
     * `article`: the ready-made article details, starting from the open page (the old Metadata Extractor);
     * `fields`: straight to picking fields on the open page (Home's product suggestion).
     */
    preset?: 'article' | 'fields';
    /** Pro: where Save version returns to (the Recipes screen). */
    onNavigate?: (view: string) => void;
}

/** The picked list's fields (columns that carry readers), if the pick was a list. */
function listFields(payload: any): any[] | undefined {
    const cols = payload?.data?.columns;
    const isList = payload?.extractionType === 'list' || payload?.extractionType === 'smart' || payload?.extractionType === 'table';
    return isList && Array.isArray(cols) && cols.some((c: any) => c?.reader) ? cols : undefined;
}

/** A page run's waits beyond the site's pace: fixed, so the review step asks only what matters. */
const PAGE_RUN_DEFAULTS = {
    clickWaitMs: 1000, loadTimeout: 10000, waitForLoad: true, enableRandomization: false,
    waitForElements: false, elementTimeout: 0, domainMinGapMs: 0, pauseOnChallenge: true,
};

export default function PageExtractorPage({ onBack, preset, onNavigate }: PageExtractorPageProps) {
    const { t } = useTranslation('pageExtractor');
    // Details first (picked on the open page), then the pages to read them from, then the run.
    const firstStep = preset === 'article' ? 2 : 1;
    const firstDetails = preset ?? 'choose';
    const [step, setStep] = useState(firstStep);
    // Which details: not chosen yet, the article set (metadata run), or fields the user points at.
    const [details, setDetails] = useState<'choose' | 'article' | 'fields'>(firstDetails);
    const [articleOptions, setArticleOptions] = useState<MetadataExtractOptions>({
        includeLinks: true, includeTables: true, includeImages: false, includeMetadata: true, outputText: false,
    });
    const article = useMetadataExtraction();
    const [showDataSourceSelector, setShowDataSourceSelector] = useState(false);
    const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
    const [isTabLoading, setIsTabLoading] = useState(false);

    // Opened for a list's details (the List Extractor's "Add details"): its item links are the pages,
    // the fields are picked on the first one, and the run's rows join onto the list.
    const [forList, setForList] = useState<DetailsDraft | null>(null);
    useEffect(() => {
        const draft = takeDetailsDraft();
        if (!draft) return;
        setForList(draft);
        setSelectedUrls(draft.urls);
        setDetails('fields');
        void pageTabId().then(id => { if (id && draft.urls[0]) void chrome.tabs.update(id, { url: draft.urls[0] }); });
    }, []);

    // Opened from "Data on this page": the fields are already picked; the user adds the pages.
    useEffect(() => {
        const draft = takePageDataDraft();
        if (!draft) return;
        setElements(draft.elements);
        setListOutput(draft.listOutput);
        setSelectedUrls([draft.url]);
        setDetails('fields');
    }, []);

    // Pro: a recipe built or edited from Recipes. An edit's fields, pages and pace load, on its first page.
    const [proEdit, setProEdit] = useState<ProEdit | null>(null);
    useEffect(() => {
        const edit = takeProEdit('page');
        if (!edit) return;
        setProEdit(edit);
        setDetails('fields');
        if (!edit.version) return;
        const input = pageEditInput(edit.version);
        setElements(input.elements);
        setSelectedUrls(input.urls);
        if (typeof input.settings.requestDelay === 'number') setRequestDelay(input.settings.requestDelay);
        if (input.settings.listOutput) setListOutput(input.settings.listOutput as 'nested' | 'rows' | 'numbered');
        void pageTabId().then(id => { if (id && input.urls[0]) void chrome.tabs.update(id, { url: input.urls[0] }); });
    }, []);

    // Track active tab loading state for the YouTube-style loading bar
    useEffect(() => {
        let activeTabId: number | null = null;

        const checkTab = () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab) return;
                activeTabId = tab.id ?? null;
                setIsTabLoading(tab.status === 'loading');
            });
        };
        checkTab();

        const onUpdated = (tabId: number, changeInfo: { status?: string }) => {
            if (tabId === activeTabId) {
                if (changeInfo.status === 'loading') setIsTabLoading(true);
                else if (changeInfo.status === 'complete') setIsTabLoading(false);
            }
        };

        const onActivated = () => {
            checkTab();
        };

        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.onActivated.addListener(onActivated);
        return () => {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            chrome.tabs.onActivated.removeListener(onActivated);
        };
    }, []);

    const { startSelection, stopSelection, status: selectionStatus, setStatus: setSelectionStatus, error: selectionError } = useSelectionMode();
    /** The field being adjusted (plan L6): the next pick replaces it in place. */
    const adjustingRef = useRef<string | null>(null);
    const [missingField, setMissingField] = useState<string | null>(null);
    const [elements, setElements] = useState<any[]>([]);

    // UI State for editing
    const [showEditModal, setShowEditModal] = useState(false);
    const [pendingElement, setPendingElement] = useState<any>(null);
    const [editingElementId, setEditingElementId] = useState<string | null>(null);
    const [elementName, setElementName] = useState('');
    const [elementAction, setElementAction] = useState<'extract' | 'click'>('extract');

    const {
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
    } = useBulkExtraction();

    const [maxConcurrent, setMaxConcurrent] = useState(defaultConcurrency);
    const [requestDelay, setRequestDelay] = useState(1000);
    const [listOutput, setListOutput] = useState<'nested' | 'rows' | 'numbered'>('nested');
    const [extractionViewport, setExtractionViewport] = useState<{ width: number; height: number } | null>(null);

    const handleReset = useCallback(() => {
        setStep(firstStep);
        setDetails(firstDetails);
        setForList(null);
        article.resetState();
        setSelectedUrls([]);
        setElements([]);
        setExtractionViewport(null);
        setMaxConcurrent(3);
        setRequestDelay(1000);
        setListOutput('nested');
        resetStoppedState();
    }, [resetStoppedState, firstStep, firstDetails, article]);

    const handleViewPartialResults = useCallback((tableId: number) => {
        const targetUrl = chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${tableId}`);
        chrome.tabs.create({ url: targetUrl });
    }, []);

    const handleStartExtraction = async () => {
        if (selectedUrls.length === 0 || elements.length === 0) return;

        let viewport = extractionViewport;
        if (!viewport) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                // A tab scripts can't run in (chrome://, the extension's own pages): the run uses its default size.
                const [result] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => ({ width: window.outerWidth, height: window.outerHeight })
                }).catch(() => []);
                if (result?.result) viewport = result.result as { width: number; height: number };
            }
        }

        await startBulkExtraction(selectedUrls, elements, {
            maxConcurrent,
            requestDelay,
            // Speed, page wait and walls are the site's (its settings card, applied by the runner).
            ...PAGE_RUN_DEFAULTS,
            listOutput,
            viewportWidth: viewport?.width,
            viewportHeight: viewport?.height,
            ...(forList ? { joinInto: { tableId: forList.tableId, urlColumn: forList.urlColumn } } : {}),
        });
    };


    const elementActionRef = useRef(elementAction);
    useEffect(() => {
        elementActionRef.current = elementAction;
    }, [elementAction]);

    // --- Highlight Sync Utility ---
    const sendHighlightMessage = highlightOnActiveTab;

    useEffect(() => {
        const offSelected = on('ELEMENT_SELECTED', selected => {
            const message = { payload: selected };
            if (selected.selectionMode === 'detail') {
                const newElement = {
                    id: Date.now().toString(),
                    name: message.payload.tagName || 'New Element',
                    selectors: message.payload.selectors ?? [],
                    action: elementActionRef.current,
                    type: message.payload.extractionType || 'text',
                    value: message.payload.previewValue,
                    // A list's fields as inferred on this page: every bulk page is read with them.
                    ...(listFields(message.payload) ? { fields: listFields(message.payload) } : {}),
                    // Where the value is in the page's data (read there first on a run).
                    ...(message.payload.dataBinding ? { data: message.payload.dataBinding } : {})
                };

                if (message.payload.viewportWidth && message.payload.viewportHeight) {
                    setExtractionViewport({ width: message.payload.viewportWidth, height: message.payload.viewportHeight });
                }

                const adjusting = adjustingRef.current;
                adjustingRef.current = null;
                setSelectionStatus('idle'); // Picker auto-deactivates
                if (adjusting) {
                    // Adjusted: the field keeps its id, name, place and action; what it reads is the new pick.
                    setElements(prev => {
                        const updated = prev.map(el => el.id !== adjusting ? el : {
                            id: el.id, name: el.name, action: el.action,
                            selectors: newElement.selectors, type: newElement.type, value: newElement.value,
                            ...(newElement.fields ? { fields: newElement.fields } : {}),
                            ...(newElement.data ? { data: newElement.data } : {}),
                        });
                        sendHighlightMessage('SHOW_SELECTION_HIGHLIGHTS', { elements: updated });
                        return updated;
                    });
                    return;
                }
                setElements(prev => [...prev, newElement]);

                // Show persistent highlight for the newly selected element
                sendHighlightMessage('ADD_SELECTION_HIGHLIGHT', { element: newElement });
            }
        });
        const offCancelled = on('PICKER_CANCELLED', () => { adjustingRef.current = null; setSelectionStatus('idle'); });

        // Handle ESC key cancellation from the side panel
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
    }, [setSelectionStatus, setElements, stopSelection]);

    /** Opens the picker on a picked field to make it wider or narrower (plan L6). */
    const handleAdjustElement = async (el: any) => {
        setMissingField(null);
        adjustingRef.current = el.id;
        const started = await startSelection('detail', el.action, { chain: el.selectors ?? [], type: el.type });
        if (!started) { adjustingRef.current = null; setMissingField(el.id); }
    };

    /** A field no longer on the page: a fresh pick replaces it in place. */
    const handleRepickElement = (el: any) => {
        setMissingField(null);
        adjustingRef.current = el.id;
        void startSelection('detail', el.action);
    };

    const handleEditElement = (el: any) => {
        setPendingElement({
            selectors: el.selectors ?? [],
            value: el.value,
            type: el.type || 'text',
            fields: el.fields,
            data: el.data
        });
        setElementName(el.name);
        setElementAction(el.action);
        setEditingElementId(el.id);
        setShowEditModal(true);
    };

    const unchanged = (before: any, after: any) => !!before && before.type === (after.type || 'text')
        && (before.selectors ?? []).join('\n') === (after.selectors ?? []).map((x: string) => x.trim()).filter(Boolean).join('\n');

    const handleSaveElement = () => {
        if (!pendingElement) return;

        const newElement = {
            id: editingElementId || Date.now().toString(),
            name: elementName,
            selectors: (pendingElement.selectors ?? []).map((s: string) => s.trim()).filter(Boolean),
            action: elementAction,
            type: pendingElement.type || 'text',
            value: pendingElement.value, // preview
            ...(pendingElement.fields ? { fields: pendingElement.fields } : {}),
            // A binding holds while the selectors and type do; an edit of them drops it.
            ...(pendingElement.data && editingElementId && unchanged(elements.find(e => e.id === editingElementId), pendingElement) ? { data: pendingElement.data } : {})
        };

        if (editingElementId) {
            setElements(prev => prev.map(el => el.id === editingElementId ? newElement : el));
        } else {
            setElements(prev => [...prev, newElement]);
        }

        setShowEditModal(false);
        setPendingElement(null);
        setEditingElementId(null);
        setElementName('');
        setElementAction('extract');
    };

    const handleDeleteElement = (id: string) => {
        setElements(prev => {
            const updated = prev.filter(el => el.id !== id);
            sendHighlightMessage('SHOW_SELECTION_HIGHLIGHTS', { elements: updated });
            return updated;
        });
    };

    const handleClearAllElements = () => {
        setElements([]);
    };

    const handleChangeElementType = (id: string, newType: string) => {
        // The page-data binding was found for the old type (a text, not a list): a selector field reads the page again.
        setElements(prev => prev.map(el => {
            if (el.id !== id) return el;
            const { data, ...rest } = el;
            return { ...rest, type: newType, ...(data && !el.selectors?.length ? { data } : {}) };
        }));
    };


    /** One step back: from the run to the pages, from the pages to the details, from the fields to the choice. */
    const goBack = () => {
        if (step === 3 && proEdit && !forList) { setStep(1); return; } // Pro: no pages step
        if (step === 2) { setStep(1); if (details === 'article') setDetails('choose'); return; }
        if (step === 1 && details === 'fields') { setDetails('choose'); return; }
        setStep(step - 1);
    };

    /** On to the pages: the page the details were chosen on comes first; more can be added. */
    const toPages = () => {
        // Pro: a recipe's pages are its samples, set in Pro; the session goes straight on to saving.
        setStep(proEdit && !forList ? 3 : 2);
        if (selectedUrls.length > 0) return;
        void pageTabId().then(async id => {
            const url = id ? (await chrome.tabs.get(id)).url : undefined;
            if (url && /^https?:/.test(url)) setSelectedUrls(prev => (prev.length ? prev : [url]));
        });
    };

    useEffect(() => {
        if (preset !== 'article') return;
        void pageTabId().then(async id => {
            const url = id ? (await chrome.tabs.get(id)).url : undefined;
            if (url && /^https?:/.test(url)) setSelectedUrls(prev => (prev.length ? prev : [url]));
        });
    }, [preset]);

    // A finished run is done with: Back clears it and leaves in one step, not back through the steps.
    const finished = hasCompleted || hasStopped || article.hasCompleted || article.hasStopped;
    const leave = () => { handleReset(); onBack(); };
    /** Back from where the tool was opened leaves it (the first choice, or a preset's first step). */
    const atStart = step === firstStep && (details === 'choose' || details === firstDetails);

    const handleRemoveUrl = (index: number) => {
        setSelectedUrls(prev => prev.filter((_, i) => i !== index));
    };

    if (showDataSourceSelector) {
        return (
            <DataSourceSelector
                onClose={() => setShowDataSourceSelector(false)}
                onSelect={(urls: string[]) => {
                    setSelectedUrls(urls);
                    setShowDataSourceSelector(false);
                }}
            />
        );
    }

    const renderStep = () => {
        switch (step) {
            case 1:
                if (details !== 'fields') {
                    return (
                        <DetailsChoice
                            onArticle={() => { setDetails('article'); toPages(); }}
                            onFields={() => setDetails('fields')} />
                    );
                }
                return (
                    <Step2Schema
                        elements={elements}
                        selectionStatus={selectionStatus}
                        isTabLoading={isTabLoading}
                        startSelection={(mode, action) => {
                            if (action) setElementAction(action);
                            startSelection(mode, action || elementAction);
                        }}
                        handleDeleteElement={handleDeleteElement}
                        handleClearAllElements={handleClearAllElements}
                        handleChangeElementType={handleChangeElementType}
                        handleEditElement={handleEditElement}
                        handleAdjustElement={handleAdjustElement}
                        handleRepickElement={handleRepickElement}
                        missingField={missingField ? { id: missingField, error: selectionError ?? 'Not found on this page.' } : null}
                        showEditModal={showEditModal}
                        setShowEditModal={setShowEditModal}
                        pendingElement={pendingElement}
                        setPendingElement={setPendingElement}
                        elementName={elementName}
                        setElementName={setElementName}
                        elementAction={elementAction}
                        handleSaveElement={handleSaveElement}
                        onBack={preset === 'fields' ? leave : () => setDetails('choose')}
                        onNext={toPages}
                        nextLabel={proEdit && !forList ? 'Next: save' : undefined}
                        onCancel={stopSelection}
                        sendHighlightMessage={sendHighlightMessage}
                        onAddElements={(els) => {
                            setElements(prev => [...prev, ...els]);
                            els.forEach(el => sendHighlightMessage('ADD_SELECTION_HIGHLIGHT', { element: el }));
                        }}
                    />
                );
            case 2:
                return (
                    <Step1Urls
                        selectedUrls={selectedUrls}
                        setSelectedUrls={setSelectedUrls}
                        setShowDataSourceSelector={setShowDataSourceSelector}
                        handleRemoveUrl={handleRemoveUrl}
                        onNext={() => setStep(3)}
                    />
                );
            case 3:
                if (details === 'article') {
                    return (
                        <MetadataStep2Run
                            selectedUrls={selectedUrls}
                            options={articleOptions}
                            setOptions={setArticleOptions}
                            maxConcurrent={maxConcurrent}
                            setMaxConcurrent={setMaxConcurrent}
                            requestDelay={requestDelay}
                            setRequestDelay={setRequestDelay}
                            isExtracting={article.isExtracting}
                            isStopping={article.isStopping}
                            hasStopped={article.hasStopped}
                            hasCompleted={article.hasCompleted}
                            completedTableId={article.completedTableId}
                            stoppedTableId={article.stoppedTableId}
                            completedCount={article.completedCount}
                            totalCount={article.totalCount}
                            activeTabs={article.activeTabs}
                            urlStatuses={article.urlStatuses}
                            previewTableId={article.previewTableId}
                            onStart={() => article.startMetadataExtraction(selectedUrls, articleOptions, { maxConcurrent, requestDelay })}
                            onStop={article.stopMetadataExtraction}
                            onBack={goBack}
                            onViewResults={id => chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${id}`) })}
                            onReset={handleReset}
                        />
                    );
                }
                // Pro: a recipe session saves the picks as a version instead of running them.
                if (proEdit && !forList) {
                    return (
                        <PageSave edit={proEdit} elements={elements} urls={selectedUrls}
                            settings={{ ...(proEdit.version?.settings ?? PAGE_RUN_DEFAULTS), requestDelay, listOutput }}
                            onBack={() => setStep(1)}
                            onDone={() => { handleReset(); setProEdit(null); onNavigate?.('pro-recipes'); }} />
                    );
                }
                return (
                    <Step3Review
                        elements={elements}
                        selectedUrls={selectedUrls}
                        isExtracting={isExtracting}
                        isStopping={isStopping}
                        hasStopped={hasStopped}
                        stoppedTableId={stoppedTableId !== null && forList ? forList.tableId : stoppedTableId}
                        hasCompleted={hasCompleted}
                        completedTableId={completedTableId !== null && forList ? forList.tableId : completedTableId}
                        completedPages={completedPages}
                        totalUniquePages={totalPages}
                        duplicatesRemoved={duplicatesRemoved}
                        listOutput={listOutput}
                        setListOutput={setListOutput}
                        activeTabs={activeTabs}
                        urlStatuses={urlStatuses}
                        previewTableId={previewTableId}
                        handleStartExtraction={handleStartExtraction}
                        onStop={stopBulkExtraction}
                        onBack={() => setStep(2)}
                        onViewPartialResults={handleViewPartialResults}
                        onReset={handleReset}
                    />
                );
            default:
                return null;
        }
    };


    return (
        <WizardLayout
            title={t('title')}
            subtitle={
                step === 1 ? t('step2.subtitle') :
                    step === 2 ? t('step1.subtitle') :
                        t('step3.subtitle')
            }
            currentStep={step}
            totalSteps={3}
            stepLabels={t('stepLabels', { returnObjects: true }) as string[]}
            onBack={atStart || (step === 3 && finished) ? leave : goBack}
            isLoading={isTabLoading && step === 1 && details === 'fields'}
        >
            {forList && (
                <Notice tone="info" className="mb-3">
                    {t('forList', { count: forList.urls.length, name: forList.listName })}
                </Notice>
            )}
            {renderStep()}
        </WizardLayout>
    );
}
