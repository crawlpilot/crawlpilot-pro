import { useRef, useState } from 'react';
import { Check, Compass, Database, Upload, X } from 'lucide-react';
import Badge from '../../ui/Badge';
import SiteDiscoveryDialog from '../SiteDiscoveryDialog';

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
    const csvInputRef = useRef<HTMLInputElement>(null);
    const [discoverOpen, setDiscoverOpen] = useState(false);

    const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            const lines = text.split(/\r?\n/);
            const newUrls: string[] = [];
            for (const line of lines) {
                // Support comma or tab separated — take the first column
                const parts = line.split(/[,\t]/);
                for (const part of parts) {
                    const url = part.trim().replace(/^"|"$/g, '');
                    if (url.startsWith('http://') || url.startsWith('https://')) {
                        newUrls.push(url);
                    }
                }
            }
            // Deduplicate and merge with existing
            const merged = Array.from(new Set([...selectedUrls, ...newUrls]));
            setSelectedUrls(merged);
        };
        reader.readAsText(file);
        // Reset so same file can be re-uploaded if needed
        e.target.value = '';
    };
    return (
        <div className="space-y-4 animate-fade-in-up">
            <div className={`card transition-all duration-300 ${selectedUrls.length > 0 ? 'border-accent-success/30' : ''}`}>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold text-white transition-colors ${selectedUrls.length > 0 ? 'bg-accent-success' : 'bg-primary'}`}>
                            {selectedUrls.length > 0 ? <Check className="w-4 h-4" /> : '1'}
                        </div>
                        <h2 className="font-semibold text-sm text-text-primary">Pages to Scrape</h2>
                    </div>
                    {selectedUrls.length > 0 && (
                        <Badge variant="success">
                            {selectedUrls.length} Loaded
                        </Badge>
                    )}
                </div>

                {selectedUrls.length > 0 ? (
                    <div className="space-y-4 animate-fade-in">
                        <div className="bg-surface-lighter rounded-lg p-3 border border-border-subtle">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <Database className="w-3.5 h-3.5 text-accent-ai" />
                                    <span className="text-xs font-medium text-text-primary">URL List</span>
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
                            Choose Different Source
                        </button>
                    </div>
                ) : (
                    <>
                        <p className="text-xs text-center text-text-muted mb-4 px-4">
                            Provide a list of page URLs to extract structured data from each one
                        </p>

                        <div className="space-y-2">
                            <button
                                className="w-full flex items-center gap-3 p-3 rounded-lg border border-dashed border-border-subtle hover:border-primary/50 hover:bg-surface-lighter transition-all text-left group"
                                onClick={() => csvInputRef.current?.click()}
                            >
                                <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center">
                                    <Upload className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-text-primary group-hover:text-primary transition-colors">Upload CSV</h3>
                                    <p className="text-xs text-text-muted mt-0.5">Import URLs from a file</p>
                                </div>
                            </button>
                            <input
                                ref={csvInputRef}
                                type="file"
                                accept=".csv,.tsv,.txt"
                                className="hidden"
                                onChange={handleCsvUpload}
                            />
                            <details className="text-[10px] text-text-muted px-1">
                                <summary className="cursor-pointer select-none hover:text-text-primary transition-colors">Expected CSV format</summary>
                                <div className="mt-1.5 pl-2 border-l border-border-subtle space-y-0.5">
                                    <p>One URL per line, or comma-separated with a header row.</p>
                                    <p className="font-mono text-text-muted/80">https://example.com/product/1</p>
                                    <p className="font-mono text-text-muted/80">https://example.com/product/2</p>
                                </div>
                            </details>

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

                            <button
                                className="w-full flex items-center gap-3 p-3 rounded-lg border border-dashed border-border-subtle hover:border-accent-warning/50 hover:bg-surface-lighter transition-all text-left group"
                                onClick={() => setDiscoverOpen(true)}
                            >
                                <div className="w-10 h-10 rounded bg-accent-warning/10 flex items-center justify-center">
                                    <Compass className="w-5 h-5 text-accent-warning" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-text-primary group-hover:text-accent-warning transition-colors">Discover from this site</h3>
                                    <p className="text-xs text-text-muted mt-0.5">Read sitemaps and group pages by type</p>
                                </div>
                            </button>
                        </div>
                    </>
                )}
            </div>

            <SiteDiscoveryDialog
                open={discoverOpen}
                onClose={() => setDiscoverOpen(false)}
                onUse={(urls) => setSelectedUrls(Array.from(new Set([...selectedUrls, ...urls])))}
            />

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
