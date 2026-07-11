import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useTableData, useAllTableData, useExportData } from '../hooks/useDatabase';
import { db } from '@/shared/db/db-manager';
import DataTable from '../components/ui/DataTable';
import Select from '../components/ui/Select';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';
import { Database, Calendar, Download, FileText, FileJson, Webhook, Zap } from 'lucide-react';

interface DataTablePageProps {
    initialTableId?: number | null;
}

export default function DataTablePage({ initialTableId = null }: DataTablePageProps) {
    const { t } = useTranslation('dataTable');
    const { tableDatas, loading: loadingAll, error: loadError, refresh: refreshAll } = useAllTableData();
    const [selectedId, setSelectedId] = useState<number | null>(initialTableId);
    const { tableData, rows, totalRows, hasMore, loading, error, refresh: refreshTable } = useTableData(selectedId);
    const { exportToCSV, exportToJSON, exportToWebhook, exportToAirtable, exportToMarkdown } = useExportData();
    const tableRef = useRef<any>(null);
    const [exportOpen, setExportOpen] = useState(false);
    const exportRef = useRef<HTMLDivElement>(null);

    // Real-time refresh: listen for extraction progress and completion messages.
    // When the currently-viewed table is a live preview, reload its rows as new
    // data is appended. Also refresh the table list when a new extraction completes.
    useEffect(() => {
        const handleMessage = (message: any) => {
            if (message.type === 'BULK_EXTRACTION_PROGRESS' || message.type === 'METADATA_EXTRACTION_PROGRESS') {
                const { previewTableId } = message.payload;
                if (previewTableId != null && previewTableId === selectedId) {
                    refreshTable();
                }
            } else if (
                message.type === 'BULK_EXTRACTION_COMPLETE' ||
                message.type === 'METADATA_EXTRACTION_COMPLETE' ||
                message.type === 'DATA_SAVED'
            ) {
                refreshAll();
                const tableId = message.payload?.tableDataId ?? message.payload?.tableId;
                if (tableId != null && tableId === selectedId) {
                    refreshTable();
                }
            }
        };
        chrome.runtime.onMessage.addListener(handleMessage);
        return () => chrome.runtime.onMessage.removeListener(handleMessage);
    }, [selectedId, refreshTable, refreshAll]);

    // Close export dropdown on outside click
    useEffect(() => {
        if (!exportOpen) return;
        const handleOutside = (e: MouseEvent) => {
            if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
                setExportOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutside);
        return () => document.removeEventListener('mousedown', handleOutside);
    }, [exportOpen]);

    const handleColumnRenamed = useCallback(async (colId: string, newName: string) => {
        if (!selectedId || !tableData) return;
        const updatedCol = tableData.columns.find(c => c.id === colId);
        if (!updatedCol) return;
        await db.updateTableColumns(selectedId, [{ ...updatedCol, name: newName }]);
    }, [selectedId, tableData]);

    const handleColumnDeleted = useCallback(async (colId: string) => {
        if (!selectedId || !tableData) return;
        await db.updateTableData(selectedId, { columns: tableData.columns.filter(c => c.id !== colId) });
        refreshTable();
    }, [selectedId, tableData, refreshTable]);

    const handleColumnsMerged = useCallback(async (merge: { id: string; name: string; sources: string[]; separator: string }) => {
        if (!selectedId || !tableData) return;
        const existing = tableData.metadata?.columnMerges || [];
        await db.updateTableData(selectedId, { metadata: { columnMerges: [...existing, merge] } });
    }, [selectedId, tableData]);

    const handleExportCSV = () => {
        if (!tableRef.current) return;
        try {
            const { columns, rows } = tableRef.current.getProcessedData();
            exportToCSV(columns, rows, tableData?.name || 'export');
        } catch (err: any) {
            alert(`Export failed: ${err.message}`);
        }
    };

    const handleExportJSON = () => {
        if (!tableRef.current) return;
        try {
            const { columns, rows } = tableRef.current.getProcessedData();
            exportToJSON(columns, rows, tableData?.name || 'export');
        } catch (err: any) {
            alert(`Export failed: ${err.message}`);
        }
    };

    const handleExportMarkdown = () => {
        if (!tableRef.current) return;
        try {
            const { columns, rows } = tableRef.current.getProcessedData();
            exportToMarkdown(columns, rows, tableData?.name || 'export');
        } catch (err: any) {
            alert(`Export failed: ${err.message}`);
        }
    };

    const hasMarkdownColumns = tableData?.columns.some(c => c.type === 'markdown') ?? false;

    const handlePremiumExport = async (type: 'webhook' | 'zapier' | 'airtable') => {
        if (!tableRef.current) return;

        try {
            const { columns, rows } = tableRef.current.getProcessedData();
            let success = false;

            if (type === 'webhook' || type === 'zapier') {
                success = await exportToWebhook(columns, rows, type);
            } else if (type === 'airtable') {
                success = await exportToAirtable(columns, rows);
            }

            if (success) {
                alert(`Successfully exported data to ${type.charAt(0).toUpperCase() + type.slice(1)}!`);
            }
        } catch (err: any) {
            alert(`Export failed: ${err.message}`);
        }
    };

    // Auto-select first table if available
    useEffect(() => {
        if (tableDatas.length > 0 && !selectedId) {
            setSelectedId(tableDatas[0].id!);
        }
    }, [tableDatas, selectedId]);

    // Read tableDataId from URL if present
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('tableDataId');
        if (id) {
            setSelectedId(Number(id));
        }
    }, []);

    if (loadingAll) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <LoadingSpinner message={t('page.loadingDatasets')} />
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="h-full flex items-center justify-center p-8">
                <div className="text-center">
                    <div className="text-5xl mb-4">❌</div>
                    <h2 className="text-xl font-bold text-accent-red mb-2">{t('page.errorTitle')}</h2>
                    <p className="text-gray-300">{loadError}</p>
                </div>
            </div>
        );
    }

    if (tableDatas.length === 0) {
        return (
            <div className="h-full flex items-center justify-center p-8 bg-background-app">
                <EmptyState
                    icon={<Database className="w-12 h-12" />}
                    title={t('page.noExtractionsTitle')}
                    description={t('page.noExtractionsDesc')}
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full bg-background-app text-text-primary">
            {/* Header - Dataset & Run Selector */}
            <div className="flex-shrink-0 px-4 py-3 bg-background-panel border-b border-border-subtle shadow-sm">
                <div className="flex items-center justify-between gap-6">
                    {/* Run Selector */}
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-1 max-w-xl group">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                                <Database className="w-4 h-4" />
                            </div>
                            <Select
                                value={selectedId || ''}
                                onChange={(value) => setSelectedId(Number(value))}
                                className="flex-1 text-sm h-10 bg-slate-900/50 border-slate-700/50 hover:border-primary/50 transition-all font-medium"
                                aria-label={t('page.selectDataset')}
                            >
                                <option value="">{t('page.selectPlaceholder')}</option>
                                {tableDatas.map((td) => (
                                    <option key={td.id} value={td.id}>
                                        {td.name} — {new Date(td.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                    </option>
                                ))}
                            </Select>
                        </div>
                    </div>

                    {/* Right: Stats & Source */}
                    {tableData && (
                        <div className="flex items-center gap-4 shrink-0">
                            <div className="hidden lg:flex items-center gap-2 text-xs text-text-muted bg-white/5 py-1.5 px-3 rounded-full border border-white/5">
                                <Calendar className="w-3.5 h-3.5" />
                                <span>{new Date(tableData.createdAt).toLocaleDateString()}</span>
                            </div>

                            <div className="flex items-center gap-1.5">
                                <Badge variant="primary" className="text-xs uppercase tracking-wider font-bold px-2 py-1 rounded-md bg-primary/20 text-primary border border-primary/20">
                                    {hasMore ? `${rows.length.toLocaleString()} / ${totalRows.toLocaleString()} ${t('page.rows')}` : `${rows.length} ${t('page.rows')}`}
                                </Badge>
                                <Badge variant="info" className="text-xs uppercase tracking-wider font-bold px-2 py-1 rounded-md bg-white/5 text-text-primary border border-white/10">
                                    {tableData.columns.length} {t('page.columns')}
                                </Badge>
                            </div>

                            {tableData.sourceUrl && (
                                <a
                                    href={tableData.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 text-accent-ai hover:text-white transition-all text-xs font-semibold"
                                    title={t('page.source')}
                                    aria-label={`${t('page.source')}: ${tableData.sourceUrl}`}
                                >
                                    <span>{t('page.source')}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                                </a>
                            )}

                            {/* Export Button */}
                            <div className="relative" ref={exportRef}>
                                <button
                                    onClick={() => setExportOpen(prev => !prev)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') setExportOpen(false);
                                    }}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm bg-primary hover:bg-primary-hover text-white focus-visible:ring-2 focus-visible:ring-accent-ai/50 focus-visible:outline-none"
                                    aria-label={t('page.export')}
                                    aria-expanded={exportOpen}
                                    aria-haspopup="menu"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>{t('page.export')}</span>
                                </button>
                                {/* Dropdown */}
                                {exportOpen && <div role="menu" aria-label={t('page.export')} className="absolute right-0 top-full mt-1 w-48 bg-background-panel border border-border-subtle rounded-lg shadow-xl overflow-hidden z-50"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') setExportOpen(false);
                                    }}
                                >
                                        <div className="px-3 py-1.5 text-xs font-bold text-gray-500 uppercase border-bottom border-border-subtle bg-white/5">
                                            {t('page.localExport')}
                                        </div>
                                        <button
                                            onClick={() => { handleExportCSV(); setExportOpen(false); }}
                                            role="menuitem"
                                            className="w-full text-left px-3 py-2.5 text-xs font-medium text-text-primary hover:bg-white/5 focus-visible:bg-white/5 focus-visible:ring-1 focus-visible:ring-accent-ai/40 focus-visible:outline-none flex items-center gap-2"
                                        >
                                            <FileText className="w-3 h-3 text-green-400" /> {t('page.exportCSV')}
                                        </button>
                                        <button
                                            onClick={() => { handleExportJSON(); setExportOpen(false); }}
                                            role="menuitem"
                                            className="w-full text-left px-3 py-2.5 text-xs font-medium text-text-primary hover:bg-white/5 focus-visible:bg-white/5 focus-visible:ring-1 focus-visible:ring-accent-ai/40 focus-visible:outline-none flex items-center gap-2"
                                        >
                                            <FileJson className="w-3 h-3 text-yellow-400" /> {t('page.exportJSON')}
                                        </button>
                                        {hasMarkdownColumns && (
                                            <button
                                                onClick={() => { handleExportMarkdown(); setExportOpen(false); }}
                                                role="menuitem"
                                                className="w-full text-left px-3 py-2.5 text-xs font-medium text-text-primary hover:bg-white/5 focus-visible:bg-white/5 focus-visible:ring-1 focus-visible:ring-accent-ai/40 focus-visible:outline-none flex items-center gap-2"
                                            >
                                                <FileText className="w-3 h-3 text-blue-300" /> {t('page.exportMarkdown')}
                                            </button>
                                        )}

                                        <div className="px-3 py-1.5 text-xs font-bold text-gray-500 uppercase border-y border-border-subtle bg-white/5">
                                            {t('page.integrations')}
                                        </div>
                                        <button
                                            onClick={() => { handlePremiumExport('webhook'); setExportOpen(false); }}
                                            role="menuitem"
                                            className="w-full text-left px-3 py-2.5 text-xs font-medium text-text-primary hover:bg-white/5 focus-visible:bg-white/5 focus-visible:ring-1 focus-visible:ring-accent-ai/40 focus-visible:outline-none flex items-center gap-2"
                                        >
                                            <Webhook className="w-3 h-3 text-purple-400" /> {t('page.exportWebhook')}
                                        </button>
                                        <button
                                            onClick={() => { handlePremiumExport('airtable'); setExportOpen(false); }}
                                            role="menuitem"
                                            className="w-full text-left px-3 py-2.5 text-xs font-medium text-text-primary hover:bg-white/5 focus-visible:bg-white/5 focus-visible:ring-1 focus-visible:ring-accent-ai/40 focus-visible:outline-none flex items-center gap-2"
                                        >
                                            <Database className="w-3 h-3 text-cyan-400" /> {t('page.exportAirtable')}
                                        </button>
                                        <button
                                            onClick={() => { handlePremiumExport('zapier'); setExportOpen(false); }}
                                            role="menuitem"
                                            className="w-full text-left px-3 py-2.5 text-xs font-medium text-text-primary hover:bg-white/5 focus-visible:bg-white/5 focus-visible:ring-1 focus-visible:ring-accent-ai/40 focus-visible:outline-none flex items-center gap-2"
                                        >
                                            <Zap className="w-3 h-3 text-orange-400" /> {t('page.exportZapier')}
                                        </button>
                                    </div>}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Data Table - Full Screen */}
            <div className="flex-1 overflow-hidden p-4">
                {loading ? (
                    <div className="h-full flex items-center justify-center">
                        <LoadingSpinner message={t('page.loadingTable')} />
                    </div>
                ) : error ? (
                    <div className="h-full flex items-center justify-center p-8">
                        <div className="text-center">
                            <div className="text-4xl mb-3">⚠️</div>
                            <p className="text-accent-error font-medium">{error}</p>
                        </div>
                    </div>
                ) : tableData && rows.length > 0 ? (
                    <div className="h-full w-full">
                        <DataTable
                            key={tableData.id}
                            ref={tableRef}
                            columns={tableData.columns}
                            rows={rows}
                            defaultHideMostlyEmptyColumns={tableData?.metadata?.extractionType !== 'bulk-page'}
                            initialMergedCols={tableData.metadata?.columnMerges}
                            onColumnRenamed={handleColumnRenamed}
                            onColumnDeleted={handleColumnDeleted}
                            onColumnsMerged={handleColumnsMerged}
                        />
                    </div>
                ) : (
                    <div className="h-full flex items-center justify-center">
                        <EmptyState
                            icon="📊"
                            title={t('page.selectDataset')}
                            description={t('page.selectDatasetDesc')}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
