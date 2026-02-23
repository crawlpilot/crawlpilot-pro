import { MousePointerClick, X } from 'lucide-react';
import Badge from '../../ui/Badge';
import Input from '../../ui/Input';

interface Step2SchemaProps {
    elements: any[];
    selectionStatus: 'idle' | 'selecting' | 'ready';
    startSelection: (mode: 'list' | 'nextButton' | 'detail') => void;
    handleDeleteElement: (id: string) => void;
    showEditModal: boolean;
    setShowEditModal: (show: boolean) => void;
    pendingElement: any;
    elementName: string;
    setElementName: (name: string) => void;
    handleSaveElement: () => void;
    onBack: () => void;
    onNext: () => void;
}

export function Step2Schema({
    elements,
    selectionStatus,
    startSelection,
    handleDeleteElement,
    showEditModal,
    setShowEditModal,
    pendingElement,
    elementName,
    setElementName,
    handleSaveElement,
    onBack,
    onNext
}: Step2SchemaProps) {
    return (
        <div className="space-y-4 animate-fade-in-up">
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
                                    className="p-1 hover:bg-background-card rounded text-text-muted hover:text-accent-error opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}

                        <button
                            onClick={() => startSelection('detail')}
                            className="w-full py-2 border border-dashed border-border-subtle rounded-md text-xs text-text-muted hover:text-text-primary hover:border-text-secondary transition-colors flex items-center justify-center gap-2 mt-4"
                        >
                            <MousePointerClick className="w-3 h-3" />
                            Add Field
                        </button>
                    </div>
                )}
            </div>

            {/* Edit Modal Custom */}
            {showEditModal && (
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
        </div>
    );
}
