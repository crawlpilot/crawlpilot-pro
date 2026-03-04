import { useState, useEffect, useRef } from 'react';
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
    const [completedPages, setCompletedPages] = useState(0);
    const [useParallel, setUseParallel] = useState(false);
    const [maxConcurrent, setMaxConcurrent] = useState(3);
    const shouldStopRef = useRef(false);

    const handleStopExtraction = () => {
        shouldStopRef.current = true;
    };

    const handleStartExtraction = async () => {
        if (selectedUrls.length === 0 || elements.length === 0) return;

        setIsExtracting(true);
        setCompletedPages(0);

        // [NEW] Deduplicate URLs to prevent redundant work
        const uniqueUrls = Array.from(new Set(selectedUrls));

        const allItems: any[] = [];
        let finalColumns: any[] = [];

        try {
            shouldStopRef.current = false;
            // Get settings
            const { extraction_settings: settings } = await chrome.storage.local.get(['extraction_settings']) as { extraction_settings?: any };
            const config = settings || { loadTimeout: 3000, requestDelay: 1000 };

            // Get active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) throw new Error("No active tab");

            // [NEW] Recipe and Job Creation
            // Trim page title to avoid massive names if it comes from a long descriptive `<title>`
            let pageTitle = tab.title || (tab.url ? new URL(tab.url).hostname : 'Page Extractor');
            if (pageTitle.length > 50) pageTitle = pageTitle.substring(0, 47) + '...';

            const extractionAction = {
                type: 'EXTRACT_PAGES',
                // Removed redundant `urls` array here to optimize schema size, 
                // it is stored at the root of the config object.
                elements: elements,
                config: config
            };

            const recipeId = await db.createRecipe({
                name: `Page Extraction - ${pageTitle}`,
                description: "Auto-generated page extraction",
                type: 'bulk-extraction',
                version: 1,
                config: {
                    type: 'bulk-extraction',
                    urls: uniqueUrls,
                    options: { actions: [extractionAction] }
                },
                createdAt: Date.now(),
                updatedAt: Date.now()
            });

            let currentJobId: number | undefined;
            const job = await db.createJob({
                recipeId: recipeId,
                name: `Extraction - ${pageTitle}`,
                status: 'running',
                sourceUrl: tab.url || '',
                configSnapshot: {
                    type: 'bulk-extraction',
                    urls: uniqueUrls,
                    options: { actions: [extractionAction] }
                },
                stats: {
                    startTime: Date.now(),
                    itemsExtracted: 0,
                    pagesVisited: 0,
                    errors: 0
                },
                createdAt: Date.now(),
                updatedAt: Date.now()
            } as any);
            currentJobId = job;

            // [NEW] Centralized Page Processor
            const processUrlOnTab = async (targetTabId: number, url: string) => {
                const batchRecordId = `rec_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                let itemData: any = { source_url: url, recordId: batchRecordId };

                const sendMessageWithRetry = async (tabId: number, message: any, maxRetries = 15, interval = 1000) => {
                    for (let attempt = 0; attempt < maxRetries; attempt++) {
                        if (shouldStopRef.current) break;
                        const response = await new Promise<any>((resolve) => {
                            chrome.tabs.sendMessage(tabId, message, (res) => {
                                if (chrome.runtime.lastError) {
                                    resolve({ success: false, error: chrome.runtime.lastError.message, isConnectionError: true });
                                } else {
                                    resolve(res);
                                }
                            });
                        });

                        if (response?.isConnectionError) {
                            console.log(`[Attempt ${attempt + 1}/${maxRetries}] Content script not ready: ${response.error}. Retrying in ${interval}ms...`);
                            await new Promise(r => setTimeout(r, interval));
                        } else {
                            return response;
                        }
                    }
                    return { success: false, error: "Max retries reached." };
                };

                for (const element of elements) {
                    if (shouldStopRef.current) break;

                    const response = await sendMessageWithRetry(targetTabId, {
                        type: 'CMD_EXTRACT_PAGE',
                        payload: {
                            actionType: 'EXTRACT_PAGES',
                            url: url,
                            elements: [element],
                            config: config
                        }
                    });

                    if (response && response.success && response.result) {
                        const { item, items, columns: resultColumns } = response.result;

                        if (resultColumns && Array.isArray(resultColumns)) {
                            resultColumns.forEach(newCol => {
                                if (!finalColumns.find(c => c.id === newCol.id)) {
                                    finalColumns.push(newCol);
                                }
                            });
                        }

                        if (items && Array.isArray(items)) {
                            if (Array.isArray(itemData)) {
                                itemData = items.map((newItem, idx) => ({
                                    ...(itemData[idx] || { recordId: batchRecordId }),
                                    ...newItem,
                                    recordId: batchRecordId
                                }));
                            } else {
                                const baseData = { ...itemData };
                                itemData = items.map((newItem, idx) => ({
                                    ...(idx === 0 ? baseData : { recordId: batchRecordId }),
                                    ...newItem,
                                    recordId: batchRecordId
                                }));
                            }
                        } else if (item) {
                            if (Array.isArray(itemData)) {
                                itemData = itemData.map((row, idx) => ({
                                    ...row,
                                    ...(idx === 0 ? item : {})
                                }));
                            } else {
                                itemData = { ...itemData, ...item };
                            }
                        }
                    }

                    if (element.action === 'click') {
                        await new Promise(resolve => setTimeout(resolve, config.requestDelay > 0 ? config.requestDelay * 2 : 2000));
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }

                return itemData;
            };

            // [NEW] Execution Router (Sequential vs Parallel)
            if (!useParallel) {
                // SEQUENTIAL: Run in active tab
                for (let i = 0; i < uniqueUrls.length; i++) {
                    if (shouldStopRef.current) break;

                    const url = uniqueUrls[i];
                    await chrome.tabs.update(tab.id, { url });
                    await new Promise(resolve => setTimeout(resolve, config.loadTimeout || 3000));

                    const extractedData = await processUrlOnTab(tab.id, url);

                    if (Array.isArray(extractedData)) {
                        allItems.push(...extractedData);
                    } else {
                        allItems.push(extractedData);
                    }

                    setCompletedPages(prev => prev + 1);

                    if (i < uniqueUrls.length - 1 && config.requestDelay > 0) {
                        await new Promise(resolve => setTimeout(resolve, config.requestDelay));
                    }
                }
            } else {
                // PARALLEL: Create background tabs
                const queue = [...uniqueUrls];

                const worker = async () => {
                    while (queue.length > 0 && !shouldStopRef.current) {
                        // Atomically grab the next URL from the queue
                        const url = queue.shift();
                        if (!url) break;

                        let bgTabId: number | undefined;

                        try {
                            const bgTab = await chrome.tabs.create({ url, active: false });
                            bgTabId = bgTab.id;
                            if (!bgTabId) continue;

                            await new Promise(resolve => setTimeout(resolve, config.loadTimeout || 3000));

                            const extractedData = await processUrlOnTab(bgTabId, url);

                            if (Array.isArray(extractedData)) {
                                allItems.push(...extractedData);
                            } else {
                                allItems.push(extractedData);
                            }
                        } catch (e) {
                            console.error(`Error processing ${url} in parallel:`, e);
                        } finally {
                            if (bgTabId) {
                                // Don't block the next iteration on tab removal
                                chrome.tabs.remove(bgTabId).catch(console.warn);
                            }
                            // Update progress atomically
                            setCompletedPages(prev => prev + 1);
                        }
                    }
                };

                // Launch workers up to maxConccurent or queue size
                const workers = Array(Math.min(maxConcurrent, uniqueUrls.length)).fill(null).map(() => worker());
                await Promise.all(workers);
            }

            if (allItems.length > 0) {
                const finalData = {
                    type: 'bulk-page',
                    items: allItems,
                    columns: finalColumns,
                    source_url: selectedUrls[0] + (selectedUrls.length > 1 ? ` (+${selectedUrls.length - 1} more)` : ''),
                    count: allItems.length,
                    timestamp: new Date().toISOString()
                };

                const tableId = await db.saveExtraction(finalData, {
                    name: `Bulk Extraction (${uniqueUrls.length} pages)`,
                    jobId: currentJobId
                });

                if (currentJobId) {
                    await db.updateJob(currentJobId, {
                        status: shouldStopRef.current ? 'paused' : 'completed',
                        result: {
                            tableDataId: tableId
                        },
                        stats: {
                            startTime: Date.now(), // Keeps the typing happy
                            endTime: Date.now(),
                            itemsExtracted: allItems.length,
                            pagesVisited: allItems.length,
                            stoppedByUser: shouldStopRef.current
                        }
                    });
                }

                // Redirect to results (New Tab)
                const targetUrl = chrome.runtime.getURL(`sidepanel.html?view=data-table&tableDataId=${tableId}`);
                chrome.tabs.create({ url: targetUrl });
            } else if (currentJobId) {
                // If it was stopped before any items, mark it as stopped
                await db.updateJob(currentJobId, {
                    status: 'paused',
                    stats: {
                        startTime: Date.now(),
                        endTime: Date.now(),
                        itemsExtracted: 0,
                        pagesVisited: 0,
                        stoppedByUser: true
                    }
                });
            }

            // Reset after success or stop
            setStep(1);
            setSelectedUrls([]);
            setElements([]);

        } catch (error) {
            console.error("Extraction failed", error);
            alert("Extraction failed: " + error);
        } finally {
            setIsExtracting(false);
            setCompletedPages(0);
        }
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
            }
        };
        chrome.runtime.onMessage.addListener(handleMessage);
        return () => chrome.runtime.onMessage.removeListener(handleMessage);
    }, [setSelectionStatus, setElements]);

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
                        onStop={handleStopExtraction}
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
