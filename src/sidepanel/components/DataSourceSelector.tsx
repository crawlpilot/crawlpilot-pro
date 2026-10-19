import { X, Database, ChevronRight } from 'lucide-react';
import { useAllTableData, useTableData } from '../hooks/useDatabase';
import { useState, useEffect, useMemo } from 'react';
import ToolHeader from './ui/ToolHeader';
import { Button, Chip, EmptyState, IconButton, Notice, Select, Spinner, Stack, Text } from '../ui';

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
        <div className="fixed inset-0 z-50 flex flex-col bg-bg text-ink animate-fade-in">
            <ToolHeader title="A list you saved" subtitle={step === 1 ? 'Pick the table with the links' : selectedTableName} onBack={handleBack}
                steps={{ labels: ['Table', 'Column'], current: step }}
                actions={<IconButton label="Close" onClick={onClose}><X /></IconButton>} />

            <div className="flex-1 overflow-y-auto p-4">
                {step === 1 ? (
                    loadingAll ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-12 text-ink-2"><Spinner size={20} /><Text size="caption" tone="muted">Loading your tables…</Text></div>
                    ) : errorAll ? (
                        <Notice tone="danger">{errorAll}</Notice>
                    ) : tableDatas.length === 0 ? (
                        <EmptyState icon={<Database />} title="No saved tables yet">Get a list first; its links can then feed this tool.</EmptyState>
                    ) : (
                        <Stack gap={1.5}>
                            {tableDatas.map((table: any) => (
                                <button key={table.id} type="button" onClick={() => table.id && handleTableSelect(table.id)}
                                    className="flex w-full cursor-pointer items-center gap-3 rounded-card border border-line bg-surface p-3 text-left transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-press">
                                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-tile-butter text-ink"><Database size={16} /></span>
                                    <span className="min-w-0 flex-1">
                                        <Text weight="semibold" truncate>{table.name || 'Untitled table'}</Text>
                                        <Text size="caption" tone="faint">{formatDate(table.createdAt || table.updatedAt || new Date().toISOString())}</Text>
                                    </span>
                                    <Chip>{table.rowCount} rows</Chip>
                                    <ChevronRight size={15} className="shrink-0 text-ink-3" />
                                </button>
                            ))}
                        </Stack>
                    )
                ) : loadingTable ? (
                    <div className="flex justify-center py-8"><Spinner size={20} /></div>
                ) : (
                    <Stack gap={3}>
                        <Select label="Column with the page addresses" value={selectedColumnId} onChange={setSelectedColumnId}
                            options={[{ value: '', label: 'Pick a column…' }, ...columnOptions]} />
                        <div className="flex items-center gap-2">
                            <Text size="small" tone="muted">Addresses found</Text>
                            <Chip tone="brand">{activeUrls.length}</Chip>
                        </div>
                        <div className="max-h-[320px] overflow-y-auto rounded-field border border-line bg-surface">
                            {activeUrls.length > 0 ? (
                                <div>
                                    {extractedUrls.map((url, idx) => {
                                        if (removedIndices.has(idx)) return null;
                                        const activeIdx = activeUrls.indexOf(url);
                                        if (!showAllUrls && activeIdx >= URL_DISPLAY_LIMIT) return null;
                                        return (
                                            <div key={idx} className="group flex items-center justify-between gap-2 border-b border-line px-3 py-1 last:border-b-0">
                                                <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink-2">{url}</span>
                                                <IconButton size="sm" label="Remove" noTooltip className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => handleRemoveUrl(idx)}><X /></IconButton>
                                            </div>
                                        );
                                    })}
                                    {!showAllUrls && activeUrls.length > URL_DISPLAY_LIMIT && (
                                        <div className="p-2 text-center"><Button size="sm" variant="ghost" onClick={() => setShowAllUrls(true)}>Show all {activeUrls.length}</Button></div>
                                    )}
                                </div>
                            ) : (
                                <Text size="small" tone="muted" className="p-8 text-center">{selectedColumnId ? 'No addresses in this column' : 'Pick a column to see its addresses'}</Text>
                            )}
                        </div>
                    </Stack>
                )}
            </div>

            <div className="border-t border-line bg-surface p-4">
                {step === 2 ? (
                    <Button variant="primary" size="lg" fullWidth onClick={handleConfirm} disabled={activeUrls.length === 0}>Use {activeUrls.length} addresses</Button>
                ) : (
                    <Button variant="ghost" fullWidth onClick={onClose}>Cancel</Button>
                )}
            </div>
        </div>
    );
}
