import { useEffect, useState } from 'react';
import { useSelectorManager } from '../hooks/useSelectorManager';
import { useSelectionMode } from '../hooks/useSelectionMode';
import { useExtractionProcess } from '../hooks/useExtractionProcess';
import { PaginationMode, SelectorState } from '../../shared/types/extraction';
import { db } from '../../shared/db/db-manager';
import { WizardLayout } from '../components/wizard/WizardLayout';
import { Step1Selection } from '../components/list-extractor/wizard/Step1Selection';
import { Step2Navigation } from '../components/list-extractor/wizard/Step2Navigation';
import { Step3Review } from '../components/list-extractor/wizard/Step3Review';
import { PaginationSpeed, DEFAULT_PAGINATION_SPEED } from '../../shared/constants/paginationConfig';
import { consolidateSelectors } from '../../shared/utils/extractionLogic';

interface ListExtractorPageProps {
    onBack?: () => void;
    onExtractionStatusChange?: (isExtracting: boolean) => void;
}

export default function ListExtractorPage({ onBack, onExtractionStatusChange }: ListExtractorPageProps) {
    // 1. Logic Hooks
    const {
        selectors,
        nextButtonSelector,
        nextButtonSelectors,
        addSelector,
        removeSelector,
        updateSelector,
        setNextButton
    } = useSelectorManager();

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

    // Notify parent of extraction status changes
    useEffect(() => {
        if (onExtractionStatusChange) {
            onExtractionStatusChange(extractionStatus.isExtracting);
        }
    }, [extractionStatus.isExtracting, onExtractionStatusChange]);

    // ... (rest of code) ...



    // 2. Wizard State
    const [step, setStep] = useState(1);
    const [paginationMode, setPaginationMode] = useState<PaginationMode>('auto');
    const [speed, setSpeed] = useState<PaginationSpeed>(DEFAULT_PAGINATION_SPEED);
    const [maxPages, setMaxPages] = useState<number>(3);
    const [previewTableId, setPreviewTableId] = useState<number | null>(null);

    // 3. Message Listener (The Bridge)
    useEffect(() => {
        const messageListener = async (message: any, sender: chrome.runtime.MessageSender) => {
            if (message.type === 'ELEMENT_SELECTED') {
                const payload = message.payload as SelectorState;
                const tabId = sender.tab?.id; // Capture sender tab ID

                if (payload.success) {
                    const isNextButton = selectingFor === 'nextButton';

                    if (isNextButton) {
                        setNextButton(
                            payload.itemSelector || payload.containerSelector,
                            payload.containerSelectors || payload.itemSelectors
                        );
                        setSelectionStatus('ready');
                    } else {
                        addSelector({
                            id: Date.now().toString(),
                            containerSelector: payload.containerSelector,
                            containerSelectors: payload.containerSelectors,
                            containerXPath: payload.containerXPath,
                            itemSelector: payload.itemSelector,
                            itemSelectors: payload.itemSelectors,
                            itemXPath: payload.itemXPath,
                            count: payload.count || 1,
                            data: payload.data,
                            patternFound: payload.patternFound || false,
                            selectionMode: 'list',
                            sourceTabId: tabId // [NEW] Store tab ID
                        });
                        setSelectionStatus('ready');

                        // Save preview data
                        if (payload.data && payload.data.items && payload.data.items.length > 0) {
                            (async () => {
                                try {
                                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                                    const pageTitle = tab?.title || new URL(payload.data.source_url || window.location.href).hostname;

                                    // Create a temporary list of all selectors including the new one to generate a complete preview
                                    const newSelector: SelectorState = {
                                        id: Date.now().toString(),
                                        containerSelector: payload.containerSelector,
                                        containerSelectors: payload.containerSelectors,
                                        containerXPath: payload.containerXPath,
                                        itemSelector: payload.itemSelector,
                                        itemSelectors: payload.itemSelectors,
                                        itemXPath: payload.itemXPath,
                                        count: payload.count || 1,
                                        data: payload.data,
                                        patternFound: payload.patternFound || false,
                                        selectionMode: 'list'
                                    };

                                    // Use shared logic to consolidate data from ALL selectors (current + new)
                                    // Note: 'selectors' state might not define 'data' fully if it's lightweight, 
                                    // but we assume for now we want to preview what we just selected + existing.
                                    // However, existing selectors in 'selectors' might not have 'data' populated if we didn't store it.
                                    // If 'selectors' in state don't keep data, we might only be able to preview the NEW data.
                                    // Checking useSelectorManager: it stores SelectorState.
                                    // If previous selectors have data, this will merge them.

                                    const previewData = consolidateSelectors([...selectors, newSelector], tab?.url);

                                    const tableId = await db.saveExtraction(previewData, {
                                        name: pageTitle,
                                        isPreview: true
                                    });
                                    setPreviewTableId(tableId);

                                    // Auto-open preview
                                    const url = chrome.runtime.getURL(`sidepanel.html?view=data-table&tableDataId=${tableId}`);
                                    chrome.windows.create({
                                        url: url,
                                        type: 'popup',
                                        width: 1000,
                                        height: 800
                                    });
                                } catch (e) {
                                    console.error('Failed to save preview', e);
                                }
                            })();
                        }
                    }
                } else {
                    setSelectionStatus('idle');
                }
            } else if (message.type === 'PICKER_CANCELLED') {
                if (selectors.length === 0 && selectingFor === 'list') setSelectionStatus('idle');
                else setSelectionStatus('ready');
            }
        };
        chrome.runtime.onMessage.addListener(messageListener);
        return () => chrome.runtime.onMessage.removeListener(messageListener);
    }, [selectingFor, selectors, addSelector, setNextButton, setSelectionStatus]);

    // Handlers
    const handleVerifySelector = async (selector: string) => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, {
                type: 'TEST_SELECTOR',
                payload: { selector }
            });
        }
    };

    const handleStart = () => {
        startExtraction(selectors, {
            mode: paginationMode,
            nextButtonSelector,
            nextButtonSelectors,
            speed,
            maxPages
        }, { tableDataId: previewTableId || undefined });

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
                        onUpdateSelector={updateSelector}
                        onTestSelector={handleVerifySelector}
                        onNext={() => setStep(2)}
                        onCancel={stopSelection}
                    />
                );
            case 2:
                return (
                    <Step2Navigation
                        paginationMode={paginationMode}
                        setPaginationMode={setPaginationMode}
                        nextButtonSelector={nextButtonSelector}
                        nextButtonSelectors={nextButtonSelectors}
                        selectingFor={selectionStatus === 'selecting' && selectingFor === 'nextButton' ? 'nextButton' : null}
                        onStartSelection={() => startSelection('nextButton')}
                        onRemoveNextButton={() => setNextButton(null)}
                        onUpdateNextButton={setNextButton}
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
                    />
                );
            default:
                return null;
        }
    };

    return (
        <WizardLayout
            title="Extract a List"
            subtitle={step === 1 ? "Select the items you want to scrape" : step === 2 ? "Configure navigation" : "Review and start"}
            currentStep={step}
            totalSteps={3}
            onBack={step === 1 ? onBack : () => setStep(step - 1)}
        >
            {renderStep()}
        </WizardLayout>
    );
}
