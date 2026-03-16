import { useState, useEffect, useRef } from 'react';
import DataSourceSelector from '../components/DataSourceSelector';
import { useSelectionMode } from '../hooks/useSelectionMode';
import { useBulkExtraction } from '../hooks/useBulkExtraction';
import { WizardLayout } from '../components/wizard/WizardLayout';

import { Step1Urls } from '../components/page-extractor/wizard/Step1Urls';
import { Step2Schema } from '../components/page-extractor/wizard/Step2Schema';
import { Step3Review } from '../components/page-extractor/wizard/Step3Review';

interface PageExtractorPageProps {
    onBack: () => void;
    onSettings?: () => void;
}

export default function PageExtractorPage({ onBack }: PageExtractorPageProps) {
    const [step, setStep] = useState(1);
    const [showDataSourceSelector, setShowDataSourceSelector] = useState(false);
    const [selectedUrls, setSelectedUrls] = useState<string[]>([]);

    // [NEW] Selection Logic
    const { startSelection, stopSelection, status: selectionStatus, setStatus: setSelectionStatus } = useSelectionMode();
    const [elements, setElements] = useState<any[]>([]);

    // Persist state across unmounts (session-only)
    useEffect(() => {
        chrome.storage.session.get(['page_extractor_state'], (result) => {
            const data = result as { page_extractor_state?: any };
            if (data.page_extractor_state) {
                const { selectedUrls: savedUrls, elements: savedElements } = data.page_extractor_state;
                if (savedUrls) setSelectedUrls(savedUrls);
                if (savedElements) setElements(savedElements);
            }
        });
    }, []);

    useEffect(() => {
        chrome.storage.session.set({
            page_extractor_state: { selectedUrls, elements }
        });
    }, [selectedUrls, elements]);

    // UI State for editing
    const [showEditModal, setShowEditModal] = useState(false);
    const [pendingElement, setPendingElement] = useState<any>(null);
    const [editingElementId, setEditingElementId] = useState<string | null>(null);
    const [elementName, setElementName] = useState('');
    const [elementAction, setElementAction] = useState<'extract' | 'click'>('extract');

    // [NEW] Extraction State
    const {
        isExtracting,
        completedPages,
        startBulkExtraction,
        stopBulkExtraction
    } = useBulkExtraction();

    const [useParallel, setUseParallel] = useState(false);
    const [maxConcurrent, setMaxConcurrent] = useState(3);

    const handleStartExtraction = async () => {
        if (selectedUrls.length === 0 || elements.length === 0) return;

        await startBulkExtraction(selectedUrls, elements, {
            useParallel,
            maxConcurrent,
            onComplete: (tableId: number) => {
                // Redirect to results (New Tab)
                const targetUrl = chrome.runtime.getURL(`sidepanel.html?view=data-table&tableDataId=${tableId}`);
                chrome.tabs.create({ url: targetUrl });

                // Reset after success
                setStep(1);
                setSelectedUrls([]);
                setElements([]);
            }
        });
    };


    const elementActionRef = useRef(elementAction);
    useEffect(() => {
        elementActionRef.current = elementAction;
    }, [elementAction]);

    useEffect(() => {
        const handleMessage = (message: any) => {
            if (message.type === 'ELEMENT_SELECTED' && message.payload.selectionMode === 'detail') {
                console.log('Element selected:', message.payload);

                const newElement = {
                    id: Date.now().toString(),
                    name: message.payload.tagName || 'New Element',
                    selectors: [{ type: 'css', value: message.payload.containerSelector }, { type: 'xpath', value: message.payload.containerXPath }],
                    action: elementActionRef.current,
                    type: message.payload.extractionType || 'text',
                    value: message.payload.previewValue
                };

                setElements(prev => [...prev, newElement]);
                setSelectionStatus('idle'); // Picker auto-deactivates
            } else if (message.type === 'PICKER_CANCELLED') {
                setSelectionStatus('idle');
            }
        };
        chrome.runtime.onMessage.addListener(handleMessage);

        // Handle ESC key cancellation from the side panel
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                stopSelection();
            }
        };
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            chrome.runtime.onMessage.removeListener(handleMessage);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [setSelectionStatus, setElements, stopSelection]);

    const handleEditElement = (el: any) => {
        setPendingElement({
            containerSelector: el.selectors.find((s: any) => s.type === 'css')?.value,
            containerXPath: el.selectors.find((s: any) => s.type === 'xpath')?.value,
            value: el.value,
            type: el.type || 'text'
        });
        setElementName(el.name);
        setElementAction(el.action);
        setEditingElementId(el.id);
        setShowEditModal(true);
    };

    const handleSaveElement = () => {
        if (!pendingElement) return;

        const newElement = {
            id: editingElementId || Date.now().toString(),
            name: elementName,
            selectors: [{ type: 'css', value: pendingElement.containerSelector }, { type: 'xpath', value: pendingElement.containerXPath }],
            action: elementAction,
            type: pendingElement.type || 'text',
            value: pendingElement.value // preview
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
        setElements(prev => prev.filter(el => el.id !== id));
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
                    // Automatically open the first URL to start selection
                    if (urls.length > 0) {
                        try {
                            // Check if chrome API is available (extension context)
                            if (typeof chrome !== 'undefined' && chrome.tabs) {
                                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                                    if (tabs.length > 0 && tabs[0].id) {
                                        chrome.tabs.update(tabs[0].id, { url: urls[0] });
                                    }
                                });
                            } else {
                                // Fallback for dev/web environment
                                window.open(urls[0], '_blank');
                            }
                        } catch (e) {
                            console.error('Failed to navigate to URL:', e);
                        }
                    }
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
                        onNext={() => setStep(2)}
                    />
                );
            case 2:
                return (
                    <Step2Schema
                        elements={elements}
                        selectionStatus={selectionStatus}
                        startSelection={(mode, action) => {
                            if (action) setElementAction(action);
                            startSelection(mode, action || elementAction);
                        }}
                        handleDeleteElement={handleDeleteElement}
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
                    />
                );
            case 3:
                return (
                    <Step3Review
                        elements={elements}
                        selectedUrls={selectedUrls} // Pass original for UI count, dedupe is internal
                        isExtracting={isExtracting}
                        completedPages={completedPages}
                        useParallel={useParallel}
                        setUseParallel={setUseParallel}
                        maxConcurrent={maxConcurrent}
                        setMaxConcurrent={setMaxConcurrent}
                        handleStartExtraction={handleStartExtraction}
                        onStop={stopBulkExtraction}
                        onBack={() => setStep(2)}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <WizardLayout
            title="Page Extractor"
            subtitle={
                step === 1 ? "Select target web pages" :
                    step === 2 ? "Configure extraction fields" :
                        "Review and extract data"
            }
            currentStep={step}
            totalSteps={3}
            onBack={step === 1 ? onBack : () => setStep(step - 1)}
        >
            {renderStep()}
        </WizardLayout>
    );
}
