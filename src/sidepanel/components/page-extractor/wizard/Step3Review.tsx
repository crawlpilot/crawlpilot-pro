import { Database, Loader2, Settings2 } from 'lucide-react';

interface Step3ReviewProps {
    elements: any[];
    selectedUrls: string[];
    isExtracting: boolean;
    completedPages: number;
    useParallel: boolean;
    setUseParallel: (val: boolean) => void;
    maxConcurrent: number;
    setMaxConcurrent: (val: number) => void;
    handleStartExtraction: () => void;
    onStop: () => void;
    onBack: () => void;
}

export function Step3Review({
    elements,
    selectedUrls,
    isExtracting,
    completedPages,
    useParallel,
    setUseParallel,
    maxConcurrent,
    setMaxConcurrent,
    handleStartExtraction,
    onStop,
    onBack
}: Step3ReviewProps) {
    return (
        <div className="space-y-4 animate-fade-in-up">
            <div className="card text-center p-8 mt-4">
                <Database className="w-12 h-12 text-primary mx-auto mb-4 opacity-80" />
                <h2 className="text-lg font-bold mb-2">Ready to Extract</h2>
                <p className="text-text-muted mb-6 text-sm">
                    Will extract {elements.length} fields from {selectedUrls.length} pages.
                </p>

                <div className="max-w-xs mx-auto text-left mb-6 bg-surface-lighter rounded-lg p-4 text-sm border border-border-subtle shadow-sm">
                    <div className="flex justify-between mb-3 border-b border-border-subtle pb-2">
                        <span className="text-text-muted">Target URLs:</span>
                        <span className="font-bold text-primary">{selectedUrls.length} pages</span>
                    </div>
                    <div className="flex justify-between pt-1">
                        <span className="text-text-muted">Schema Fields:</span>
                        <span className="font-bold text-accent-ai">{elements.length} fields</span>
                    </div>
                </div>

                {!isExtracting && (
                    <div className="max-w-xs mx-auto text-left mb-8 bg-surface-lighter rounded-lg p-4 text-sm border border-border-subtle shadow-sm">
                        <div className="flex items-center mb-4">
                            <Settings2 className="w-4 h-4 mr-2 text-text-muted" />
                            <span className="font-semibold text-text-primary">Execution Settings</span>
                        </div>

                        <div className="flex items-center justify-between mb-4">
                            <label className="text-text-muted cursor-pointer select-none" htmlFor="parallel-toggle">
                                Parallel Processing
                            </label>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    id="parallel-toggle"
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={useParallel}
                                    onChange={(e) => setUseParallel(e.target.checked)}
                                />
                                <div className="w-9 h-5 bg-surface-darker peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                            </label>
                        </div>

                        {useParallel && (
                            <div className="animate-fade-in-up">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-text-muted text-xs">Max Concurrent Tabs</span>
                                    <span className="font-bold text-primary text-xs">{maxConcurrent}</span>
                                </div>
                                <input
                                    type="range"
                                    min="1"
                                    max="5"
                                    step="1"
                                    value={maxConcurrent}
                                    onChange={(e) => setMaxConcurrent(parseInt(e.target.value))}
                                    className="w-full accent-primary"
                                />
                                <p className="text-[10px] text-text-muted mt-2 leading-tight">
                                    Warning: High values may consume significant memory or trigger website rate limits.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {isExtracting && (
                    <div className="mb-8 p-5 rounded-lg border border-accent-ai/30 bg-accent-ai/5 text-left max-w-sm mx-auto">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-medium text-text-primary flex items-center">
                                <Loader2 className="w-4 h-4 text-accent-ai animate-spin mr-2" />
                                Extracting Items...
                            </span>
                            <span className="text-xs font-bold text-accent-ai">{completedPages} / {selectedUrls.length}</span>
                        </div>
                        <div className="w-full bg-surface-darker h-2.5 rounded-full overflow-hidden shadow-inner">
                            <div
                                className="bg-gradient-to-r from-accent-ai to-primary h-full transition-all duration-300 rounded-full"
                                style={{ width: `${Math.max(5, (completedPages / selectedUrls.length) * 100)}%` }}
                            />
                        </div>
                    </div>
                )}

                {isExtracting ? (
                    <button
                        onClick={onStop}
                        className="btn btn-secondary text-accent-error border-accent-error/30 hover:bg-accent-error/10 w-full max-w-sm mx-auto h-12 shadow-lg text-base transition-colors"
                    >
                        <Loader2 className="w-5 h-5 mr-2 animate-spin text-accent-error" />
                        Stop Extraction
                    </button>
                ) : (
                    <button
                        onClick={handleStartExtraction}
                        disabled={selectedUrls.length === 0 || elements.length === 0}
                        className="btn btn-primary w-full max-w-sm mx-auto h-12 shadow-lg shadow-primary/20 text-base"
                    >
                        <Database className="w-5 h-5 mr-2" />
                        Start Bulk Extraction
                    </button>
                )}

                {!isExtracting && (
                    <button
                        onClick={onBack}
                        className="btn btn-ghost text-sm mt-4 inline-flex justify-center w-full max-w-sm mx-auto"
                    >
                        Go Back
                    </button>
                )}
            </div>
        </div>
    );
}
