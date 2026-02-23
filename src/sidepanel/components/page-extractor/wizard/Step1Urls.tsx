import { Check, Database, Upload, X } from 'lucide-react';
import Badge from '../../ui/Badge';

interface Step1UrlsProps {
    selectedUrls: string[];
    setSelectedUrls: (urls: string[]) => void;
    setShowDataSourceSelector: (show: boolean) => void;
    handleRemoveUrl: (index: number) => void;
    onNext: () => void;
}

export function Step1Urls({
    selectedUrls,
    setSelectedUrls,
    setShowDataSourceSelector,
    handleRemoveUrl,
    onNext
}: Step1UrlsProps) {
    return (
        <div className="space-y-4 animate-fade-in-up">
            <div className={`card transition-all duration-300 ${selectedUrls.length > 0 ? 'border-accent-success/30' : ''}`}>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold text-white transition-colors ${selectedUrls.length > 0 ? 'bg-accent-success' : 'bg-primary'}`}>
                            {selectedUrls.length > 0 ? <Check className="w-4 h-4" /> : '1'}
                        </div>
                        <h2 className="font-semibold text-sm text-text-primary">Target URLs</h2>
                    </div>
                    {selectedUrls.length > 0 && (
                        <Badge variant="success">
                            {selectedUrls.length} Ready
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

                            <div className="max-h-[160px] overflow-y-auto custom-scrollbar border border-border-subtle rounded bg-background-app/50 p-2">
                                {selectedUrls.map((url, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-1.5 text-xs border-b border-border-subtle last:border-0 group">
                                        <span className="truncate text-text-muted font-mono flex-1 mr-4" title={url}>{url}</span>
                                        <button
                                            onClick={() => handleRemoveUrl(idx)}
                                            className="text-text-muted hover:text-accent-error opacity-0 group-hover:opacity-100 transition-all ml-2 flex-shrink-0"
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
                                <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center">
                                    <Upload className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-text-primary group-hover:text-primary transition-colors">Upload CSV</h3>
                                    <p className="text-xs text-text-muted mt-0.5">Import URLs from a file</p>
                                </div>
                            </button>

                            <button
                                className="w-full flex items-center gap-3 p-3 rounded-lg border border-dashed border-border-subtle hover:border-accent-ai/50 hover:bg-surface-lighter transition-all text-left group"
                                onClick={() => setShowDataSourceSelector(true)}
                            >
                                <div className="w-10 h-10 rounded bg-accent-ai/10 flex items-center justify-center">
                                    <Database className="w-5 h-5 text-accent-ai" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-text-primary group-hover:text-accent-ai transition-colors">Select Data Source</h3>
                                    <p className="text-xs text-text-muted mt-0.5">Use links from existing tables</p>
                                </div>
                            </button>
                        </div>
                    </>
                )}
            </div>

            <div className="flex justify-end pt-2">
                <button
                    onClick={onNext}
                    disabled={selectedUrls.length === 0}
                    className="btn btn-primary px-6"
                >
                    Next step
                </button>
            </div>
        </div>
    );
}
