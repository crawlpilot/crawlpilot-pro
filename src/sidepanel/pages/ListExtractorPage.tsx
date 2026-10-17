import { useEffect, useState } from 'react';
import { on, sendToTab } from '../../shared/messages';
import { useTranslation } from 'react-i18next';
import { useSelectorManager } from '../hooks/useSelectorManager';
import { useSelectionMode } from '../hooks/useSelectionMode';
import { useExtractionProcess } from '../hooks/useExtractionProcess';
import { PaginationMode, SelectorState } from '../../shared/types/extraction';
import { db } from '../../shared/db';
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
    const { t } = useTranslation('listExtractor');
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
        const offSelected = on('ELEMENT_SELECTED', (selected, sender) => {
            const payload = selected as SelectorState;
            const tabId = sender.tab?.id;

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
                                // Use sender.tab — this is the actual page the user picked from,
                                // not whatever tab happens to be active in the window right now.
                                const sourceTabInfo = sender.tab;
                                const pageTitle = sourceTabInfo?.title
                                    || (sourceTabInfo?.url ? new URL(sourceTabInfo.url).hostname : null)
                                    || new URL(payload.data.source_url || window.location.href).hostname;

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

                                const previewData = consolidateSelectors([...selectors, newSelector], sourceTabInfo?.url);

                                // Pass the existing previewTableId so we UPDATE the same record
                                // instead of creating a new one each time the user picks elements.
                                const tableId = await db.tables.save(previewData, {
                                    name: pageTitle,
                                    isPreview: true,
                                    tableDataId: previewTableId || undefined,
                                    clearExisting: !!previewTableId
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
        });
        const offCancelled = on('PICKER_CANCELLED', () => {
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
    }, [selectingFor, selectors, addSelector, setNextButton, setSelectionStatus, stopSelection]);

    // Handlers
    const handleVerifySelector = async (selector: string) => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) void sendToTab(tab.id, 'TEST_SELECTOR', { selector }).catch(() => { /* not connected */ });
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
            title={t('title')}
            subtitle={step === 1 ? t('step1.subtitle') : step === 2 ? t('step2.subtitle') : t('step3.subtitle')}
            currentStep={step}
            totalSteps={3}
            onBack={step === 1 ? onBack : () => setStep(step - 1)}
        >
            {renderStep()}
        </WizardLayout>
    );
}
