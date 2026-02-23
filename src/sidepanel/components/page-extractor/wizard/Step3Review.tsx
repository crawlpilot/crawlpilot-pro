import { Database, Loader2 } from 'lucide-react';

interface Step3ReviewProps {
    elements: any[];
    selectedUrls: string[];
    isExtracting: boolean;
    currentUrlIndex: number;
    handleStartExtraction: () => void;
    onBack: () => void;
}

export function Step3Review({
    elements,
    selectedUrls,
    isExtracting,
    currentUrlIndex,
    handleStartExtraction,
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

                <div className="max-w-xs mx-auto text-left mb-8 bg-surface-lighter rounded-lg p-4 text-sm border border-border-subtle shadow-sm">
                    <div className="flex justify-between mb-3 border-b border-border-subtle pb-2">
                        <span className="text-text-muted">Target URLs:</span>
                        <span className="font-bold text-primary">{selectedUrls.length} pages</span>
                    </div>
                    <div className="flex justify-between pt-1">
                        <span className="text-text-muted">Schema Fields:</span>
                        <span className="font-bold text-accent-ai">{elements.length} fields</span>
                    </div>
                </div>

                {isExtracting && (
                    <div className="mb-8 p-5 rounded-lg border border-accent-ai/30 bg-accent-ai/5 text-left max-w-sm mx-auto">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-medium text-text-primary flex items-center">
                                <Loader2 className="w-4 h-4 text-accent-ai animate-spin mr-2" />
                                Processing URL
                            </span>
                            <span className="text-xs font-bold text-accent-ai">{currentUrlIndex + 1} / {selectedUrls.length}</span>
                        </div>
                        <div className="w-full bg-surface-darker h-2.5 rounded-full overflow-hidden shadow-inner">
                            <div
                                className="bg-gradient-to-r from-accent-ai to-primary h-full transition-all duration-300 rounded-full"
                                style={{ width: `${Math.max(5, ((currentUrlIndex + 1) / selectedUrls.length) * 100)}%` }}
                            />
                        </div>
                    </div>
                )}

                <button
                    onClick={handleStartExtraction}
                    disabled={isExtracting || selectedUrls.length === 0 || elements.length === 0}
                    className={`btn btn-primary w-full max-w-sm mx-auto h-12 shadow-lg shadow-primary/20 text-base ${isExtracting ? 'opacity-80 cursor-wait' : ''}`}
                >
                    {isExtracting ? (
                        <>
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            Analyzing & Extracting...
                        </>
                    ) : (
                        <>
                            <Database className="w-5 h-5 mr-2" />
                            Start Bulk Extraction
                        </>
                    )}
                </button>

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
