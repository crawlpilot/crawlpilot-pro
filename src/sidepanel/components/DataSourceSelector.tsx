import { X, Database, ChevronRight, ChevronLeft } from 'lucide-react';
import { useAllTableData, useTableData } from '../hooks/useDatabase';
import Badge from './ui/Badge';
import { useState, useEffect, useMemo } from 'react';
import Select from './ui/Select';

interface DataSourceSelectorProps {
    onClose: () => void;
    onSelect: (urls: string[]) => void;
}

export default function DataSourceSelector({ onClose, onSelect }: DataSourceSelectorProps) {
    const [step, setStep] = useState<1 | 2>(1);
    const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
    const [selectedColumnId, setSelectedColumnId] = useState<string>('');
    const [extractedUrls, setExtractedUrls] = useState<string[]>([]);
    const [removedIndices, setRemovedIndices] = useState<Set<number>>(new Set());
    const URL_DISPLAY_LIMIT = 50;
    const [showAllUrls, setShowAllUrls] = useState(false);
    useEffect(() => { setShowAllUrls(false); }, [extractedUrls]);

    // Step 1 Data
    const { tableDatas, loading: loadingAll, error: errorAll } = useAllTableData();

    // Step 2 Data
    const { tableData, rows, loading: loadingTable } = useTableData(selectedTableId);

    const handleTableSelect = (id: number) => {
        setSelectedTableId(id);
        setStep(2);
        setRemovedIndices(new Set());
        setSelectedColumnId('');
    };

    const handleBack = () => {
        if (step === 2) {
            setStep(1);
            setSelectedTableId(null);
        } else {
            onClose();
        }
    };

    const formatDate = (dateString: string) => {
        try {
            return new Date(dateString).toLocaleDateString();
        } catch (e) {
            return dateString;
        }
    };

    // Extract URLs when column changes
    useEffect(() => {
        if (selectedColumnId && rows.length > 0) {
            const urls: string[] = [];
            rows.forEach((row: any) => {
                const val = row.data[selectedColumnId];
                if (typeof val === 'string' && (val.startsWith('http') || val.startsWith('www'))) {
                    urls.push(val);
                } else if (typeof val === 'object' && val !== null && (val as any).href) {
                    // Handle link objects if any
                    urls.push((val as any).href);
                }
            });
            setExtractedUrls(urls);
            setRemovedIndices(new Set());
        } else {
            setExtractedUrls([]);
        }
    }, [selectedColumnId, rows]);

    const activeUrls = useMemo(() => {
        return extractedUrls.filter((_, i) => !removedIndices.has(i));
    }, [extractedUrls, removedIndices]);

    const handleRemoveUrl = (index: number) => {
        const newSet = new Set(removedIndices);
        newSet.add(index);
        setRemovedIndices(newSet);
    };

    const handleConfirm = () => {
        onSelect(activeUrls);
        onClose();
    };

    // Columns options
    const columnOptions = useMemo(() => {
        if (!tableData?.columns) return [];
        return tableData.columns
            .filter((col: any) => {
                const type = (col.type || '').toLowerCase();
                const name = (col.name || '').toLowerCase();
                return type === 'url' || name.includes('url') || name.includes('link') || name.includes('href');
            })
            .map((col: any) => {
                // Calculate count of valid URLs in this column
                const urlCount = rows.reduce((acc, row: any) => {
                    const val = row.data[col.id];
                    const isUrl = (typeof val === 'string' && (val.startsWith('http') || val.startsWith('www'))) ||
                        (typeof val === 'object' && val !== null && (val as any).href);
                    return acc + (isUrl ? 1 : 0);
                }, 0);

                return {
                    value: col.id,
                    label: `${col.name} (${col.type}) • ${urlCount} URLs`
                };
            });
    }, [tableData, rows]);

    const selectedTableName = useMemo(() => {
        if (!selectedTableId) return '';
        return tableDatas.find((t: any) => t.id === selectedTableId)?.name || 'Unknown Table';
    }, [selectedTableId, tableDatas]);

    return (
        <div className="fixed inset-0 z-50 bg-background-app flex flex-col animate-fade-in text-text-primary">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border-subtle bg-app">
                <div className="flex items-center gap-3">
                    <div className="w-1 h-6 bg-primary rounded-full"></div>
                    <h2 className="font-semibold text-sm text-text-primary uppercase tracking-wide">Select Source Data</h2>
                </div>
                <button
                    onClick={onClose}
                    className="btn btn-ghost p-2"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Stepper */}
            <div className="flex items-center justify-between px-8 py-4 border-b border-border-subtle bg-background-card">
                <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold transition-all duration-300 ${step === 1
                        ? 'bg-primary text-white shadow-soft'
                        : 'bg-accent-success text-white'
                        }`}>
                        {step === 1 ? '1' : '✓'}
                    </div>
                    <span className={`text-xs font-medium uppercase tracking-wide transition-colors ${step === 1 ? 'text-primary' : 'text-text-muted'}`}>Select Table</span>
                </div>

                <div className="flex-1 mx-6 h-[1px] bg-border-subtle relative">
                    <div className={`absolute top-1/2 left-0 -translate-y-1/2 h-[2px] bg-primary rounded-full transition-all duration-500 ${step === 2 ? 'w-full' : 'w-1/2'}`}></div>
                </div>

                <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold border transition-all duration-300 ${step === 2
                        ? 'bg-primary text-white border-primary shadow-soft'
                        : 'bg-surface-lighter text-text-muted border-border-subtle'
                        }`}>
                        2
                    </div>
                    <span className={`text-xs font-medium uppercase tracking-wide transition-colors ${step === 2 ? 'text-primary' : 'text-text-muted'}`}>Select Columns</span>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-background-app">
                {step === 1 ? (
                    <>
                        <p className="text-xs text-text-muted mb-4 px-1">Choose a previous extraction to use as source:</p>

                        {loadingAll ? (
                            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mb-2"></div>
                                <span className="text-xs">Loading data...</span>
                            </div>
                        ) : errorAll ? (
                            <div className="p-3 rounded bg-accent-error/10 border border-accent-error/20 text-accent-error text-xs text-center border-l-2 border-l-accent-error">
                                {errorAll}
                            </div>
                        ) : tableDatas.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-text-muted border border-dashed border-border-subtle rounded-lg bg-surface-lighter/30">
                                <Database className="w-8 h-8 opacity-20 mb-3" />
                                <p className="text-xs">No extraction history found</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {tableDatas.map((table: any) => (
                                    <button
                                        key={table.id}
                                        onClick={() => table.id && handleTableSelect(table.id)}
                                        className="w-full card cursor-pointer hover:border-primary/50 transition-all duration-200 group text-left p-3"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-8 h-8 rounded bg-surface-lighter flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                                                    <Database className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <h3 className="font-medium text-text-primary text-sm truncate group-hover:text-primary transition-colors">
                                                        {table.name || 'Untitled Extraction'}
                                                    </h3>
                                                    <p className="text-[10px] text-text-muted font-mono mt-0.5">
                                                        {formatDate(table.createdAt || table.updatedAt || new Date().toISOString())}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3 flex-shrink-0">
                                                <Badge variant="primary" className="text-[10px] px-1.5 py-0.5 bg-surface-lighter text-text-secondary border-border-subtle">
                                                    {table.rowCount} rows
                                                </Badge>
                                                <ChevronRight className="w-3.5 h-3.5 text-text-muted group-hover:text-text-primary transition-colors" />
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="space-y-4">
                        <div className="mb-2">
                            <h3 className="font-semibold text-text-primary text-sm">{selectedTableName}</h3>
                            <p className="text-xs text-text-muted">Select column containing URLs:</p>
                        </div>

                        {loadingTable ? (
                            <div className="py-8 text-center text-xs text-text-muted">Loading columns...</div>
                        ) : (
                            <>
                                <div className="mb-4">
                                    <Select
                                        value={selectedColumnId}
                                        onChange={(val) => setSelectedColumnId(val)}
                                        className="w-full text-xs"
                                    >
                                        <option value="">Select a column...</option>
                                        {columnOptions.map((opt: any) => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </Select>
                                </div>

                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-text-muted text-xs">URLs found</span>
                                    <Badge variant="primary" className="bg-surface-lighter text-text-primary border-border-subtle">
                                        {activeUrls.length}
                                    </Badge>
                                </div>

                                <div className="border border-border-subtle rounded-lg bg-surface-lighter/30 overflow-hidden max-h-[300px] overflow-y-auto custom-scrollbar">
                                    {activeUrls.length > 0 ? (
                                        <div className="divide-y divide-border-subtle/50">
                                            {extractedUrls.map((url, idx) => {
                                                if (removedIndices.has(idx)) return null;
                                                const activeIdx = activeUrls.indexOf(url);
                                                if (!showAllUrls && activeIdx >= URL_DISPLAY_LIMIT) return null;
                                                return (
                                                    <div key={idx} className="p-2 flex items-center justify-between hover:bg-surface-lighter group">
                                                        <span className="text-xs text-primary truncate max-w-[90%] font-mono">
                                                            {url}
                                                        </span>
                                                        <button
                                                            onClick={() => handleRemoveUrl(idx)}
                                                            className="text-text-muted hover:text-accent-error opacity-0 group-hover:opacity-100 transition-all"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                            {!showAllUrls && activeUrls.length > URL_DISPLAY_LIMIT && (
                                                <div className="p-2 text-center">
                                                    <button onClick={() => setShowAllUrls(true)} className="text-xs text-accent-primary hover:underline">
                                                        Show all {activeUrls.length} URLs
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="p-8 text-center text-text-muted text-xs">
                                            {selectedColumnId ? 'No URLs found in this column' : 'Select a column to preview URLs'}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border-subtle bg-background-card pb-6">
                {step === 2 ? (
                    <div className="space-y-3">
                        <button
                            onClick={handleConfirm}
                            disabled={activeUrls.length === 0}
                            className={`w-full btn h-10 ${activeUrls.length > 0
                                ? 'btn-primary'
                                : 'bg-surface-lighter text-text-muted cursor-not-allowed'
                                }`}
                        >
                            Use {activeUrls.length} URLs
                        </button>

                        <button
                            onClick={handleBack}
                            className="w-full btn btn-ghost text-xs h-8 gap-2"
                        >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            Back
                        </button>
                    </div>
                ) : (
                    <div className="flex justify-center">
                        <button
                            onClick={onClose}
                            className="btn btn-ghost text-xs text-text-muted hover:text-text-primary gap-2"
                        >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            Cancel
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
