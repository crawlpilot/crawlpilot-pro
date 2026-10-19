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

interface PageExtractorPageProps {
    onBack: () => void;
}

/** The picked list's fields (columns that carry readers), if the pick was a list. */
function listFields(payload: any): any[] | undefined {
    const cols = payload?.data?.columns;
    const isList = payload?.extractionType === 'list' || payload?.extractionType === 'smart' || payload?.extractionType === 'table';
    return isList && Array.isArray(cols) && cols.some((c: any) => c?.reader) ? cols : undefined;
}

export default function PageExtractorPage({ onBack }: PageExtractorPageProps) {
    const { t } = useTranslation('pageExtractor');
    const [step, setStep] = useState(1);
    const [showDataSourceSelector, setShowDataSourceSelector] = useState(false);
    const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
    const [isTabLoading, setIsTabLoading] = useState(false);

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

    const { startSelection, stopSelection, status: selectionStatus, setStatus: setSelectionStatus } = useSelectionMode();
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

    const [maxConcurrent, setMaxConcurrent] = useState(3);
    const [clickWaitMs, setClickWaitMs] = useState(1000);
    const [requestDelay, setRequestDelay] = useState(1000);
    const [loadTimeout, setLoadTimeout] = useState(10000);
    const [waitForLoad, setWaitForLoad] = useState(true);
    const [enableRandomization, setEnableRandomization] = useState(false);
    const [waitForElements, setWaitForElements] = useState(false);
    const [elementTimeout, setElementTimeout] = useState(0);
    const [domainMinGapMs, setDomainMinGapMs] = useState(0);
    const [pauseOnChallenge, setPauseOnChallenge] = useState(true);
    const [listOutput, setListOutput] = useState<'nested' | 'rows' | 'numbered'>('nested');
    const [extractionViewport, setExtractionViewport] = useState<{ width: number; height: number } | null>(null);

    const handleReset = useCallback(() => {
        setStep(1);
        setSelectedUrls([]);
        setElements([]);
        setExtractionViewport(null);
        setMaxConcurrent(3);
        setClickWaitMs(1000);
        setRequestDelay(1000);
        setLoadTimeout(10000);
        setWaitForLoad(true);
        setEnableRandomization(false);
        setWaitForElements(false);
        setElementTimeout(0);
        setDomainMinGapMs(0);
        setPauseOnChallenge(true);
        setListOutput('nested');
        resetStoppedState();
    }, [resetStoppedState]);

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
                const [result] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => ({ width: window.outerWidth, height: window.outerHeight })
                });
                if (result?.result) viewport = result.result as { width: number; height: number };
            }
        }

        await startBulkExtraction(selectedUrls, elements, {
            maxConcurrent,
            clickWaitMs,
            requestDelay,
            loadTimeout,
            waitForLoad,
            enableRandomization,
            waitForElements,
            elementTimeout,
            domainMinGapMs,
            pauseOnChallenge,
            listOutput,
            viewportWidth: viewport?.width,
            viewportHeight: viewport?.height
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

                setElements(prev => [...prev, newElement]);
                setSelectionStatus('idle'); // Picker auto-deactivates

                // Show persistent highlight for the newly selected element
                sendHighlightMessage('ADD_SELECTION_HIGHLIGHT', { element: newElement });
            }
        });
        const offCancelled = on('PICKER_CANCELLED', () => setSelectionStatus('idle'));

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
        setElements(prev => prev.map(el =>
            el.id === id ? { ...el, type: newType } : el
        ));
    };


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
                return (
                    <Step1Urls
                        selectedUrls={selectedUrls}
                        setSelectedUrls={setSelectedUrls}
                        setShowDataSourceSelector={setShowDataSourceSelector}
                        handleRemoveUrl={handleRemoveUrl}
                        onNext={() => {
                            if (selectedUrls.length > 0) {
                                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                                    if (tabs.length > 0 && tabs[0].id) {
                                        chrome.tabs.update(tabs[0].id, { url: selectedUrls[0] });
                                    }
                                });
                            }
                            setStep(2);
                        }}
                    />
                );
            case 2:
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
                        showEditModal={showEditModal}
                        setShowEditModal={setShowEditModal}
                        pendingElement={pendingElement}
                        setPendingElement={setPendingElement}
                        elementName={elementName}
                        setElementName={setElementName}
                        elementAction={elementAction}
                        handleSaveElement={handleSaveElement}
                        onBack={() => setStep(1)}
                        onNext={() => setStep(3)}
                        onCancel={stopSelection}
                        sendHighlightMessage={sendHighlightMessage}
                        onAddElements={(els) => {
                            setElements(prev => [...prev, ...els]);
                            els.forEach(el => sendHighlightMessage('ADD_SELECTION_HIGHLIGHT', { element: el }));
                        }}
                    />
                );
            case 3:
                return (
                    <Step3Review
                        elements={elements}
                        selectedUrls={selectedUrls}
                        isExtracting={isExtracting}
                        isStopping={isStopping}
                        hasStopped={hasStopped}
                        stoppedTableId={stoppedTableId}
                        hasCompleted={hasCompleted}
                        completedTableId={completedTableId}
                        completedPages={completedPages}
                        totalUniquePages={totalPages}
                        duplicatesRemoved={duplicatesRemoved}
                        maxConcurrent={maxConcurrent}
                        setMaxConcurrent={setMaxConcurrent}
                        clickWaitMs={clickWaitMs}
                        setClickWaitMs={setClickWaitMs}
                        requestDelay={requestDelay}
                        setRequestDelay={setRequestDelay}
                        loadTimeout={loadTimeout}
                        setLoadTimeout={setLoadTimeout}
                        waitForLoad={waitForLoad}
                        setWaitForLoad={setWaitForLoad}
                        enableRandomization={enableRandomization}
                        setEnableRandomization={setEnableRandomization}
                        waitForElements={waitForElements}
                        setWaitForElements={setWaitForElements}
                        elementTimeout={elementTimeout}
                        setElementTimeout={setElementTimeout}
                        domainMinGapMs={domainMinGapMs}
                        setDomainMinGapMs={setDomainMinGapMs}
                        pauseOnChallenge={pauseOnChallenge}
                        setPauseOnChallenge={setPauseOnChallenge}
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
                step === 1 ? t('step1.subtitle') :
                    step === 2 ? t('step2.subtitle') :
                        t('step3.subtitle')
            }
            currentStep={step}
            totalSteps={3}
            stepLabels={t('stepLabels', { returnObjects: true }) as string[]}
            onBack={step === 1 ? onBack : () => setStep(step - 1)}
            isLoading={isTabLoading && step <= 2}
        >
            {renderStep()}
        </WizardLayout>
    );
}
