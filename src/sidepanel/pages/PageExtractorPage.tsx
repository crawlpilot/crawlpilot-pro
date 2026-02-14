import {
    RotateCcw,
    X,
    Upload,
    Database,
    MousePointerClick,
    Info,
    Loader2,
    Settings
} from 'lucide-react';
import Badge from '../components/ui/Badge';
import { useState, useEffect } from 'react';
import DataSourceSelector from '../components/DataSourceSelector';
import { db } from '../../shared/db/db-manager';
import { useSelectionMode } from '../hooks/useSelectionMode'; // [NEW]
import Input from '../components/ui/Input'; // [NEW]

interface PageExtractorPageProps {
    onBack: () => void;
    onSettings?: () => void;
}

export default function PageExtractorPage({ onBack, onSettings }: PageExtractorPageProps) {
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

    // [NEW] Extraction State
    const [isExtracting, setIsExtracting] = useState(false);
    const [currentUrlIndex, setCurrentUrlIndex] = useState(0);

    // DB Import (lazy or top level)
    // Importing db (assuming top level import is added or available via closure if I add it)
    // I need to add import { db } from '../../shared/db/db-manager'; at the top. 
    // Since I can't add imports easily with this tool without checking top, I will do it in a separate step or assume I can replace the top.

    // Actually, I should use the `db` from imports. 
    // Let's implement the logic assuming `db` needs to be imported. I'll check imports later.

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
            action: 'extract',
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

    return (
        <div className="flex flex-col h-full bg-app text-text-primary overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border-subtle bg-app sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-surface-lighter flex items-center justify-center">
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-primary"
                        >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="font-bold text-sm leading-none tracking-wide text-text-primary uppercase">Page Extractor</h1>
                        <p className="text-xs text-text-muted mt-0.5 font-mono">Bulk data extraction</p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button className="btn btn-ghost p-1.5 h-8 w-8">
                        <Info className="w-4 h-4" />
                    </button>
                    <button className="btn btn-ghost p-1.5 h-8 w-8">
                        <RotateCcw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onSettings}
                        className="btn btn-ghost p-1.5 h-8 w-8 text-primary"
                    >
                        <Settings className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onBack}
                        className="btn btn-ghost p-1.5 h-8 w-8"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="p-4 space-y-4">
                {/* Video Banner (Placeholder for future tutorial) */}
                {/* <div className="relative group overflow-hidden rounded-xl bg-gray-900 border border-gray-800 p-3 flex items-center gap-4 cursor-pointer hover:border-gray-700 transition-colors">...</div> */}

                {/* Step 1: Select URLs */}
                <div className={`card transition-all duration-300 ${selectedUrls.length > 0 ? 'border-accent-success/30' : ''}`}>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold text-white transition-colors ${selectedUrls.length > 0 ? 'bg-accent-success' : 'bg-primary'}`}>
                                {selectedUrls.length > 0 ? '✓' : '1'}
                            </div>
                            <h2 className="font-semibold text-sm text-text-primary">Target URLs</h2>
                        </div>
                        {selectedUrls.length > 0 && (
                            <Badge variant="success">
                                Ready
                            </Badge>
                        )}
                    </div>

                    {selectedUrls.length > 0 ? (
                        <div className="space-y-4 animate-fade-in">
                            <div className="bg-surface-lighter rounded-lg p-3 border border-border-subtle">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Database className="w-3.5 h-3.5 text-accent-ai" />
                                        <span className="text-xs font-medium text-text-primary">Source Data</span>
                                    </div>
                                    <button
                                        onClick={() => setSelectedUrls([])}
                                        className="text-[10px] text-accent-error hover:text-red-400 uppercase tracking-wider font-medium"
                                    >
                                        Clear
                                    </button>
                                </div>

                                <div className="max-h-[120px] overflow-y-auto custom-scrollbar border border-border-subtle rounded bg-background-app/50 p-2">
                                    {selectedUrls.map((url, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-1.5 text-xs border-b border-border-subtle last:border-0 group">
                                            <span className="truncate text-text-muted font-mono flex-1 mr-4">{url}</span>
                                            <button
                                                onClick={() => handleRemoveUrl(idx)}
                                                className="text-text-muted hover:text-accent-error opacity-0 group-hover:opacity-100 transition-all"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={() => setShowDataSourceSelector(true)}
                                className="w-full btn btn-secondary text-xs"
                            >
                                <Database className="w-3 h-3 mr-2" />
                                Change Data Source
                            </button>
                        </div>
                    ) : (
                        <>
                            <p className="text-xs text-center text-text-muted mb-4 px-4">
                                Select source URLs to begin extraction
                            </p>

                            <div className="space-y-2">
                                <button className="w-full flex items-center gap-3 p-3 rounded-lg border border-dashed border-border-subtle hover:border-primary/50 hover:bg-surface-lighter transition-all text-left group">
                                    <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center">
                                        <Upload className="w-4 h-4 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-semibold text-text-primary group-hover:text-primary transition-colors">Upload CSV</h3>
                                        <p className="text-[10px] text-text-muted">Import from file</p>
                                    </div>
                                </button>

                                <button
                                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-dashed border-border-subtle hover:border-accent-ai/50 hover:bg-surface-lighter transition-all text-left group"
                                    onClick={() => setShowDataSourceSelector(true)}
                                >
                                    <div className="w-8 h-8 rounded bg-accent-ai/10 flex items-center justify-center">
                                        <Database className="w-4 h-4 text-accent-ai" />
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-semibold text-text-primary group-hover:text-accent-ai transition-colors">Select Data Source</h3>
                                        <p className="text-[10px] text-text-muted">Use extracted links</p>
                                    </div>
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* Step 2: Select What To Extract */}
                <div className="card">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-6 h-6 rounded-md bg-surface-lighter text-text-secondary border border-border-subtle flex items-center justify-center text-xs font-bold">
                            2
                        </div>
                        <h2 className="font-semibold text-sm text-text-primary">Extraction Schema</h2>
                    </div>

                    {elements.length === 0 ? (
                        <div className="grid grid-cols-2 gap-3">
                            <div
                                className="p-4 border border-dashed border-border-subtle rounded-lg bg-surface-lighter/50 flex flex-col items-center justify-center text-center group cursor-pointer hover:border-primary/50 transition-colors"
                                onClick={() => startSelection('detail')}
                            >
                                <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                                    <MousePointerClick className="w-4 h-4 text-primary" />
                                </div>
                                <h3 className="text-xs font-medium text-text-primary mb-0.5">
                                    {selectionStatus === 'selecting' ? 'Selecting...' : 'Select Elements'}
                                </h3>
                                <p className="text-[10px] text-text-muted">Extract data fields</p>
                            </div>

                            <div
                                className="p-4 border border-dashed border-border-subtle rounded-lg bg-surface-lighter/50 flex flex-col items-center justify-center text-center group cursor-pointer hover:border-accent-warning/50 transition-colors"
                                onClick={() => startSelection('detail')}
                            >
                                <div className="w-8 h-8 bg-accent-warning/10 rounded-lg flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-warning">
                                        <path d="M14 9l6 6-6 6"></path><path d="M4 4v5"></path><path d="M4 4h5"></path><path d="M4 4l16 16"></path>
                                    </svg>
                                </div>
                                <h3 className="text-xs font-medium text-text-primary mb-0.5">
                                    Register Click
                                </h3>
                                <p className="text-[10px] text-text-muted">Interactions/Pagination</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {elements.map((el) => (
                                <div key={el.id} className="p-2.5 bg-surface-lighter border border-border-subtle rounded-md flex items-center justify-between group">
                                    <div className="flex items-center gap-3">
                                        <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-primary font-mono text-[10px] font-bold">
                                            Tx
                                        </div>
                                        <div>
                                            <div className="font-medium text-xs text-text-primary">{el.name}</div>
                                            <div className="text-[10px] text-text-muted truncate max-w-[180px] font-mono">{el.value || 'No preview'}</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteElement(el.id)}
                                        className="p-1 hover:bg-background-card rounded text-text-muted hover:text-accent-error opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}

                            <button
                                onClick={() => startSelection('detail')}
                                className="w-full py-2 border border-dashed border-border-subtle rounded-md text-xs text-text-muted hover:text-text-primary hover:border-text-secondary transition-colors flex items-center justify-center gap-2"
                            >
                                <MousePointerClick className="w-3 h-3" />
                                Add Field
                            </button>
                        </div>
                    )}
                </div>

                {/* Edit Modal - Technical Dark Theme */}
                {showEditModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                        <div className="bg-background-card border border-border-subtle rounded-lg w-full max-w-sm overflow-hidden shadow-2xl">
                            <div className="p-3 border-b border-border-subtle flex items-center justify-between bg-surface-lighter">
                                <div className="flex items-center gap-2">
                                    <Badge variant="ai">Detected</Badge>
                                    <span className="text-xs font-mono text-text-muted">Confidence: High</span>
                                </div>
                                <button onClick={() => setShowEditModal(false)} className="text-text-muted hover:text-text-primary">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="p-4 space-y-4">
                                <div>
                                    <Input
                                        label="Field Name"
                                        value={elementName}
                                        onChange={(e) => setElementName(e.target.value)}
                                        placeholder="e.g. title, price, description"
                                        className="font-mono text-xs"
                                        autoFocus
                                    />
                                </div>
                                <div className="bg-background-app p-3 rounded border border-border-subtle">
                                    <div className="text-[10px] text-text-muted mb-1 uppercase tracking-wide">Preview Value</div>
                                    <div className="text-xs text-text-primary font-mono truncate">{pendingElement?.value || 'No content'}</div>
                                    {pendingElement?.selector && (
                                        <div className="mt-2 pt-2 border-t border-border-subtle">
                                            <div className="text-[10px] text-text-muted mb-0.5">CSS Selector</div>
                                            <div className="text-[10px] text-accent-ai font-mono truncate">{pendingElement.selector}</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="p-3 border-t border-border-subtle bg-surface-lighter flex justify-end gap-2">
                                <button
                                    onClick={() => setShowEditModal(false)}
                                    className="btn btn-ghost text-xs h-8"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveElement}
                                    disabled={!elementName.trim()}
                                    className="btn btn-primary text-xs h-8"
                                >
                                    Save Field
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Step 3: Action Footer */}
            <div className="p-4 border-t border-border-subtle bg-surface-lighter sticky bottom-0 z-20">
                <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-text-muted">
                        {isExtracting ? (
                            <span className="text-accent-ai animate-pulse">Processing URL {currentUrlIndex + 1} of {selectedUrls.length}...</span>
                        ) : (
                            <span>Ready to extract {elements.length} fields from {selectedUrls.length} pages</span>
                        )}
                    </div>
                </div>
                <button
                    onClick={handleStartExtraction}
                    disabled={selectedUrls.length === 0 || elements.length === 0 || isExtracting}
                    className={`btn btn-primary w-full h-10 shadow-lg shadow-primary/10 text-sm ${isExtracting ? 'opacity-80 cursor-wait' : ''}`}
                >
                    {isExtracting ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Extracting...
                        </>
                    ) : (
                        <>
                            <Database className="w-4 h-4 mr-2" />
                            Start Bulk Extraction
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
