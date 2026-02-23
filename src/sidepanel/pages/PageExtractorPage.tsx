import { useState, useEffect } from 'react';
import DataSourceSelector from '../components/DataSourceSelector';
import { db } from '../../shared/db/db-manager';
import { useSelectionMode } from '../hooks/useSelectionMode';
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
    const { startSelection, status: selectionStatus, setStatus: setSelectionStatus } = useSelectionMode();
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
    const [isExtracting, setIsExtracting] = useState(false);
    const [currentUrlIndex, setCurrentUrlIndex] = useState(0);

    const handleStartExtraction = async () => {
        if (selectedUrls.length === 0 || elements.length === 0) return;

        setIsExtracting(true);
        setCurrentUrlIndex(0);

        const allItems: any[] = [];
        const columns = elements.map(el => ({ id: el.id, name: el.name, type: el.type }));

        try {
            // Get settings
            const { extraction_settings: settings } = await chrome.storage.local.get(['extraction_settings']) as { extraction_settings?: any };
            const config = settings || { loadTimeout: 3000, requestDelay: 1000 };

            // Get active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) throw new Error("No active tab");

            for (let i = 0; i < selectedUrls.length; i++) {
                setCurrentUrlIndex(i);
                const url = selectedUrls[i];

                // Navigate
                await chrome.tabs.update(tab.id, { url });

                // Wait for load
                await new Promise(resolve => setTimeout(resolve, config.loadTimeout || 3000));

                // Execute Extraction via Message
                const response = await new Promise<any>((resolve) => {
                    chrome.tabs.sendMessage(tab.id!, {
                        type: 'EXTRACT_FROM_SCHEMA',
                        payload: { schema: elements }
                    }, (res) => resolve(res));
                });

                if (response && response.success && response.data) {
                    const extractedItem = { ...response.data, source_url: url };
                    allItems.push(extractedItem);
                } else {
                    console.warn(`Failed to extract from ${url}`, response?.error);
                }

                // Request delay between pages
                if (i < selectedUrls.length - 1 && config.requestDelay > 0) {
                    await new Promise(resolve => setTimeout(resolve, config.requestDelay));
                }
            }

            const finalData = {
                type: 'bulk-page',
                items: allItems,
                columns: columns,
                source_url: selectedUrls[0] + ` (+${selectedUrls.length - 1} more)`,
                count: allItems.length,
                timestamp: new Date().toISOString()
            };

            const tableId = await db.saveExtraction(finalData, {
                name: `Bulk Extraction (${selectedUrls.length} pages)`
            });

            // Redirect to results (New Tab)
            const url = chrome.runtime.getURL(`sidepanel.html?view=data-table&tableDataId=${tableId}`);
            chrome.tabs.create({ url });

            // Reset after success
            setStep(1);
            setSelectedUrls([]);
            setElements([]);

        } catch (error) {
            console.error("Extraction failed", error);
            alert("Extraction failed: " + error);
        } finally {
            setIsExtracting(false);
            setCurrentUrlIndex(0);
        }
    };

    useEffect(() => {
        const handleMessage = (message: any) => {
            if (message.type === 'ELEMENT_SELECTED' && message.payload.selectionMode === 'detail') {
                console.log('Element selected:', message.payload);
                setPendingElement(message.payload);
                setElementName(message.payload.tagName || 'New Element');
                setShowEditModal(true);
                setSelectionStatus('idle'); // Picker auto-deactivates
            }
        };
        chrome.runtime.onMessage.addListener(handleMessage);
        return () => chrome.runtime.onMessage.removeListener(handleMessage);
    }, [setSelectionStatus]);

    const handleSaveElement = () => {
        if (!pendingElement) return;

        const newElement = {
            id: editingElementId || Date.now().toString(),
            name: elementName,
            selectors: [{ type: 'css', value: pendingElement.selector }, { type: 'xpath', value: pendingElement.xpath }],
            action: elementAction,
            type: 'text',
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
                            startSelection(mode);
                        }}
                        handleDeleteElement={handleDeleteElement}
                        showEditModal={showEditModal}
                        setShowEditModal={setShowEditModal}
                        pendingElement={pendingElement}
                        elementName={elementName}
                        setElementName={setElementName}
                        elementAction={elementAction}
                        setElementAction={setElementAction}
                        handleSaveElement={handleSaveElement}
                        onBack={() => setStep(1)}
                        onNext={() => setStep(3)}
                    />
                );
            case 3:
                return (
                    <Step3Review
                        elements={elements}
                        selectedUrls={selectedUrls}
                        isExtracting={isExtracting}
                        currentUrlIndex={currentUrlIndex}
                        handleStartExtraction={handleStartExtraction}
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
