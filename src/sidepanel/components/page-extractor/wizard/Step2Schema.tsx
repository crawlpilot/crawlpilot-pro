import { useEffect } from 'react';
import { MousePointerClick, X } from 'lucide-react';
import Badge from '../../ui/Badge';
import Input from '../../ui/Input';

interface Step2SchemaProps {
    elements: any[];
    selectionStatus: 'idle' | 'selecting' | 'ready';
    startSelection: (mode: 'list' | 'nextButton' | 'detail', action?: 'extract' | 'click') => void;
    handleDeleteElement: (id: string) => void;
    handleChangeElementType: (id: string, newType: string) => void;
    handleEditElement: (el: any) => void;
    showEditModal: boolean;
    setShowEditModal: (show: boolean) => void;
    pendingElement: any;
    setPendingElement: (el: any) => void;
    elementName: string;
    setElementName: (name: string) => void;
    elementAction: 'extract' | 'click';
    handleSaveElement: () => void;
    onBack: () => void;
    onNext: () => void;
    onCancel: () => void;
    sendHighlightMessage: (type: string, payload?: any) => Promise<void>;
}

export function Step2Schema({
    elements,
    selectionStatus,
    startSelection,
    handleDeleteElement,
    handleChangeElementType,
    handleEditElement,
    showEditModal,
    setShowEditModal,
    pendingElement,
    setPendingElement,
    elementName,
    setElementName,
    elementAction,
    handleSaveElement,
    onBack,
    onNext,
    onCancel,
    sendHighlightMessage
}: Step2SchemaProps) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (selectionStatus === 'selecting') {
                const actionKeys: Record<string, string> = {
                    ArrowUp: 'ArrowUp',
                    ArrowDown: 'ArrowDown',
                    Enter: 'Enter'
                };
                const action = actionKeys[e.key];
                if (action) {
                    e.preventDefault();
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        const tabId = tabs[0]?.id;
                        if (tabId) {
                            chrome.tabs.sendMessage(tabId, { type: 'PICKER_ACTION', payload: { action } });
                        }
                    });
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectionStatus]);

    // --- Persistent Selection Highlights Sync ---
    useEffect(() => {
        // Show highlights for all already-selected elements when Step 2 mounts
        if (elements.length > 0) {
            sendHighlightMessage('SHOW_SELECTION_HIGHLIGHTS', { elements });
        }

        // Clear highlights when Step 2 unmounts (user leaves this step)
        return () => {
            sendHighlightMessage('CLEAR_SELECTION_HIGHLIGHTS');
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only on mount/unmount


    return (
        <div className="space-y-4 animate-fade-in-up">
            <div className="card">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-6 h-6 rounded-md bg-surface-lighter text-text-secondary border border-border-subtle flex items-center justify-center text-xs font-bold">
                        2
                    </div>
                    <h2 className="font-semibold text-sm text-text-primary">Extraction Schema</h2>
                </div>

                {selectionStatus === 'selecting' && (
                    <div className="mb-4 p-6 border-2 border-dashed border-primary bg-primary/5 text-center rounded-xl">
                        <div className="flex justify-center mb-4 text-primary animate-pulse">
                            <MousePointerClick className="w-10 h-10" />
                        </div>
                        <h3 className="text-base font-semibold text-primary mb-1">
                            Selection Mode Active
                        </h3>
                        <p className="text-sm text-text-muted mb-4">
                            Click on an element in the page to select it.
                        </p>
                        <button
                            onClick={onCancel}
                            className="text-sm text-text-muted hover:text-text-primary underline transition-colors"
                        >
                            Press ESC to cancel
                        </button>
                    </div>
                )}

                {elements.length === 0 && selectionStatus !== 'selecting' ? (
                    <div className="grid grid-cols-2 gap-3">
                        <div
                            className="p-4 border border-dashed border-border-subtle rounded-lg bg-surface-lighter/50 flex flex-col items-center justify-center text-center group cursor-pointer hover:border-primary/50 transition-colors"
                            onClick={() => startSelection('detail', 'extract')}
                        >
                            <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                                <MousePointerClick className="w-4 h-4 text-primary" />
                            </div>
                            <h3 className="text-xs font-medium text-text-primary mb-0.5">
                                Select Elements
                            </h3>
                            <p className="text-[10px] text-text-muted">Extract data fields</p>
                        </div>

                        <div
                            className="p-4 border border-dashed border-border-subtle rounded-lg bg-surface-lighter/50 flex flex-col items-center justify-center text-center group cursor-pointer hover:border-accent-warning/50 transition-colors"
                            onClick={() => startSelection('detail', 'click')}
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
                            <div key={el.id} className="p-2.5 bg-surface-lighter border border-border-subtle rounded-md group">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0" style={{
                                            backgroundColor: el.action === 'click' ? 'var(--color-accent-warning-10, rgba(245,158,11,0.1))' : 'var(--color-primary-10, rgba(34,211,238,0.1))',
                                            color: el.action === 'click' ? 'var(--color-accent-warning, #f59e0b)' : 'var(--color-primary, #22d3ee)'
                                        }}>
                                            {el.action === 'click' ? '⚡' : (el.type === 'image' ? '🖼' : (el.type === 'link' ? '🔗' : (el.type === 'list' || el.type === 'table' ? '☰' : 'Tx')))}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-medium text-xs text-text-primary truncate max-w-[140px]">{el.name}</div>
                                            <div className="text-[10px] text-text-muted truncate max-w-[140px] font-mono">{el.value || 'No preview'}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        <button
                                            onClick={() => handleEditElement(el)}
                                            className="p-1 hover:bg-background-card rounded text-text-muted hover:text-primary transition-colors"
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-current">
                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => handleDeleteElement(el.id)}
                                            className="p-1 hover:bg-background-card rounded text-text-muted hover:text-accent-error transition-colors"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                                {el.action === 'extract' && (
                                    <div className="mt-1.5 pt-1.5 border-t border-border-subtle/50">
                                        <select
                                            value={el.type || 'text'}
                                            onChange={(e) => handleChangeElementType(el.id, e.target.value)}
                                            className="w-full h-[26px] bg-background-app border border-border-subtle rounded text-[10px] text-text-secondary px-2 focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all outline-none cursor-pointer"
                                        >
                                            <option value="text">📝 Text Content</option>
                                            <option value="link">🔗 Link (href)</option>
                                            <option value="image">🖼️ Image (src)</option>
                                            <option value="list">📋 List (Rows)</option>
                                            <option value="table">📊 Table (Rows)</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                        ))}

                        <div className="flex gap-2 mt-4">
                            <button
                                onClick={() => startSelection('detail', 'extract')}
                                className="flex-1 py-2 border border-dashed border-border-subtle rounded-md text-xs text-text-muted hover:text-text-primary hover:border-text-secondary transition-colors flex items-center justify-center gap-2"
                            >
                                <MousePointerClick className="w-3 h-3" />
                                Add Field
                            </button>
                            <button
                                onClick={() => startSelection('detail', 'click')}
                                className="flex-1 py-2 border border-dashed border-border-subtle rounded-md text-xs text-text-muted hover:text-accent-warning hover:border-accent-warning/50 transition-colors flex items-center justify-center gap-2"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-current">
                                    <path d="M14 9l6 6-6 6"></path><path d="M4 4v5"></path><path d="M4 4h5"></path><path d="M4 4l16 16"></path>
                                </svg>
                                Register Click
                            </button>
                        </div>
                    </div>
                )}

            </div>

            {/* Edit Modal Custom */}
            {
                showEditModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                        <div className="bg-background-card border border-border-subtle rounded-lg w-full max-w-sm overflow-hidden shadow-2xl">
                            <div className="p-3 border-b border-border-subtle flex items-center justify-between bg-surface-lighter">
                                <div className="flex items-center gap-2">
                                    <Badge variant="ai">Detected</Badge>
                                    <span className="text-xs font-mono text-text-muted">Confidence: High</span>
                                </div>
                                <button onClick={() => setShowEditModal(false)} className="text-text-muted hover:text-text-primary flex-shrink-0">
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
                                {elementAction === 'extract' && pendingElement && (
                                    <div>
                                        <div className="text-[10px] text-text-muted mb-1 font-medium">Extraction Type</div>
                                        <select
                                            value={pendingElement.type || 'text'}
                                            onChange={(e) => setPendingElement({ ...pendingElement, type: e.target.value })}
                                            className="w-full h-[36px] bg-background-app border border-border-subtle rounded text-xs text-text-primary px-3 focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all outline-none"
                                        >
                                            <option value="text">Text Content (Default)</option>
                                            <option value="link">Link Target (href)</option>
                                            <option value="image">Image Source (src)</option>
                                            <option value="list">Structured Fields (Smart)</option>
                                            <option value="table">Table Data</option>
                                        </select>
                                    </div>
                                )}

                                <div className="bg-background-app p-3 rounded border border-border-subtle">
                                    <div className="text-[10px] text-text-muted mb-1 uppercase tracking-wide">Preview Value</div>
                                    <div className="text-xs text-text-primary font-mono truncate">{pendingElement?.value || 'No content'}</div>
                                    {pendingElement && (
                                        <div className="mt-4 space-y-3">
                                            <div>
                                                <div className="text-[10px] text-text-muted mb-1">CSS Selector</div>
                                                <input
                                                    value={pendingElement.containerSelector || ''}
                                                    onChange={(e) => setPendingElement({ ...pendingElement, containerSelector: e.target.value })}
                                                    className="w-full text-[10px] text-accent-ai font-mono bg-surface-lighter border border-border-subtle rounded px-2 py-1.5 focus:outline-none focus:border-primary transition-colors"
                                                />
                                            </div>
                                            <div>
                                                <div className="text-[10px] text-text-muted mb-1">XPath</div>
                                                <input
                                                    value={pendingElement.containerXPath || ''}
                                                    onChange={(e) => setPendingElement({ ...pendingElement, containerXPath: e.target.value })}
                                                    className="w-full text-[10px] text-accent-ai font-mono bg-surface-lighter border border-border-subtle rounded px-2 py-1.5 focus:outline-none focus:border-primary transition-colors"
                                                />
                                            </div>
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
                )
            }

            <div className="flex justify-end pt-2 gap-3">
                <button
                    onClick={onBack}
                    className="btn btn-secondary px-6"
                >
                    Back
                </button>
                <button
                    onClick={onNext}
                    disabled={elements.length === 0}
                    className="btn btn-primary px-6"
                >
                    Review & Execute
                </button>
            </div>
        </div >
    );
}
