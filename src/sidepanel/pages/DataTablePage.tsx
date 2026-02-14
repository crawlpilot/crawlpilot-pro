import { useState, useEffect, useRef } from 'react';
import { useTableData, useAllTableData, useExportData } from '../hooks/useDatabase';
import DataTable from '../components/ui/DataTable';
import Select from '../components/ui/Select';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';
import { Database, Calendar, Download, FileText, FileJson } from 'lucide-react';

interface DataTablePageProps {
    initialTableId?: number | null;
}

export default function DataTablePage({ initialTableId = null }: DataTablePageProps) {
    const { tableDatas, loading: loadingAll, error: loadError } = useAllTableData();
    const [selectedId, setSelectedId] = useState<number | null>(initialTableId);
    const { tableData, rows, loading, error } = useTableData(selectedId);
    const { exportToCSV, exportToJSON } = useExportData();
    const tableRef = useRef<any>(null);

    const handleExportCSV = () => {
        if (tableRef.current) {
            const { columns, rows } = tableRef.current.getProcessedData();
            exportToCSV(columns, rows, tableData?.name || 'export');
        }
    };

    const handleExportJSON = () => {
        if (tableRef.current) {
            const { columns, rows } = tableRef.current.getProcessedData();
            exportToJSON(columns, rows, tableData?.name || 'export');
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
                <LoadingSpinner message="Loading datasets..." />
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="h-full flex items-center justify-center p-8">
                <div className="text-center">
                    <div className="text-5xl mb-4">❌</div>
                    <h2 className="text-xl font-bold text-accent-red mb-2">Error Loading Data</h2>
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
                    title="No Extractions Yet"
                    description="You haven't extracted any data yet. Use the extraction tools from the home page to get started."
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
                            >
                                <option value="">Select an extraction run...</option>
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
                                <Badge variant="primary" className="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-md bg-primary/20 text-primary border border-primary/20">
                                    {rows.length} rows
                                </Badge>
                                <Badge variant="info" className="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-md bg-white/5 text-text-primary border border-white/10">
                                    {tableData.columns.length} columns
                                </Badge>
                            </div>

                            {tableData.sourceUrl && (
                                <a
                                    href={tableData.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 text-accent-ai hover:text-white transition-all text-xs font-semibold"
                                    title="Open Source URL"
                                >
                                    <span>Source</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                                </a>
                            )}

                            {/* Export Button */}
                            <div className="relative group">
                                <button
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-bold transition-colors shadow-sm"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>Export</span>
                                </button>
                                {/* Dropdown */}
                                <div className="absolute right-0 top-full mt-1 w-32 bg-background-panel border border-border-subtle rounded-lg shadow-xl overflow-hidden hidden group-hover:block z-50">
                                    <button
                                        onClick={handleExportCSV}
                                        className="w-full text-left px-3 py-2 text-xs font-medium text-text-primary hover:bg-white/5 flex items-center gap-2"
                                    >
                                        <FileText className="w-3 h-3 text-green-400" /> CSV / Excel
                                    </button>
                                    <button
                                        onClick={handleExportJSON}
                                        className="w-full text-left px-3 py-2 text-xs font-medium text-text-primary hover:bg-white/5 flex items-center gap-2"
                                    >
                                        <FileJson className="w-3 h-3 text-yellow-400" /> JSON
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Data Table - Full Screen */}
            <div className="flex-1 overflow-hidden p-4">
                {loading ? (
                    <div className="h-full flex items-center justify-center">
                        <LoadingSpinner message="Loading table data..." />
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
                            ref={tableRef}
                            columns={tableData.columns}
                            rows={rows}
                        />
                    </div>
                ) : (
                    <div className="h-full flex items-center justify-center">
                        <EmptyState
                            icon="📊"
                            title="Select a Dataset"
                            description="Choose a dataset from the dropdown above to view its contents"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
