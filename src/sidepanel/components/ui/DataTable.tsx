import { useMemo, useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { AgGridReact } from 'ag-grid-react';
// ... same imports as before ...
import {
    ColDef,
    ModuleRegistry,
    ClientSideRowModelModule,
    ValidationModule,
    TextFilterModule,
    NumberFilterModule,
    DateFilterModule,
    RowSelectionModule,
    PaginationModule,
    CsvExportModule,
    TextEditorModule,
    ICellRendererParams
} from 'ag-grid-community';
import type { Column, TableRow } from '@/shared/types/database';
import { Edit, Delete, CallMerge, Close, Check, ArrowForward } from '@mui/icons-material';
import { IconButton, Tooltip } from '@mui/material';
import Button from './Button';

ModuleRegistry.registerModules([
    ClientSideRowModelModule,
    ValidationModule,
    TextFilterModule,
    NumberFilterModule,
    DateFilterModule,
    RowSelectionModule,
    PaginationModule,
    CsvExportModule,
    TextEditorModule
]);

export interface DataTableRef {
    getProcessedData: () => { columns: { id: string, name: string }[], rows: any[] };
}

interface DataTableProps {
    columns: Column[];
    rows: TableRow[];
}

// Custom Header Component
const CustomHeader = (props: any) => {
    // ... same content as before ...
    const [isEditing, setIsEditing] = useState(false);
    const [tempName, setTempName] = useState(props.displayName);

    useEffect(() => {
        setTempName(props.displayName);
    }, [props.displayName]);

    const onSave = () => {
        if (tempName.trim()) {
            props.context.onRenameColumn(props.column.colId, tempName);
            setIsEditing(false);
        }
    };

    const onDelete = () => {
        if (confirm(`Are you sure you want to delete column "${props.displayName}"?`)) {
            props.context.onDeleteColumn(props.column.colId);
        }
    };

    return (
        <div className="flex items-center justify-between w-full group">
            {isEditing ? (
                <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
                    <input
                        type="text"
                        value={tempName}
                        onChange={(e) => setTempName(e.target.value)}
                        className="w-full text-xs px-1 py-0.5 border rounded bg-white text-gray-900"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') onSave();
                            if (e.key === 'Escape') setIsEditing(false);
                        }}
                    />
                    <IconButton size="small" onClick={onSave} sx={{ color: 'success.main', p: 0.5 }}>
                        <Check fontSize="small" sx={{ fontSize: 14 }} />
                    </IconButton>
                    <IconButton size="small" onClick={() => setIsEditing(false)} sx={{ color: 'error.main', p: 0.5 }}>
                        <Close fontSize="small" sx={{ fontSize: 14 }} />
                    </IconButton>
                </div>
            ) : (
                <div className="flex items-center justify-between w-full">
                    <span className="truncate font-semibold text-gray-700 dark:text-gray-300" title={props.displayName}>{props.displayName}</span>
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                        <Tooltip title="Rename">
                            <IconButton
                                size="small"
                                onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                                sx={{ p: 0.5, color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                            >
                                <Edit fontSize="small" sx={{ fontSize: 14 }} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                            <IconButton
                                size="small"
                                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                                sx={{ p: 0.5, color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                            >
                                <Delete fontSize="small" sx={{ fontSize: 14 }} />
                            </IconButton>
                        </Tooltip>
                    </div>
                </div>
            )}
        </div>
    );
};

const DataTable = forwardRef<DataTableRef, DataTableProps>(({ columns, rows }, ref) => {
    // Filter states
    const [showFilters, setShowFilters] = useState(false);
    const [showMerge, setShowMerge] = useState(false);

    // Feature States
    const [removeEmptyRows, setRemoveEmptyRows] = useState(true);
    const [removeEmptyColumns, setRemoveEmptyColumns] = useState(true);
    const [hideRepeatingData, setHideRepeatingData] = useState(true);
    const [removeDuplicateColumns, setRemoveDuplicateColumns] = useState(true);
    const [prioritizeRichColumns, setPrioritizeRichColumns] = useState(true);
    const [showImages, setShowImages] = useState(true);
    const [hideMostlyEmptyColumns, setHideMostlyEmptyColumns] = useState(true);

    // Column Management States
    const [renames, setRenames] = useState<Record<string, string>>({});
    const [deletedCols, setDeletedCols] = useState<Set<string>>(new Set());
    const [mergedCols, setMergedCols] = useState<Array<{ id: string, name: string, sources: string[], separator: string }>>([]);

    // Merge UI States
    const [mergeCol1, setMergeCol1] = useState('');
    const [mergeCol2, setMergeCol2] = useState('');
    const [mergeName, setMergeName] = useState('');
    const [mergeSep, setMergeSep] = useState(' ');

    // Callbacks for Context
    const onRenameColumn = useCallback((colId: string, newName: string) => {
        setRenames(prev => ({ ...prev, [colId]: newName }));
    }, []);

    const onDeleteColumn = useCallback((colId: string) => {
        setDeletedCols(prev => {
            const next = new Set(prev);
            next.add(colId);
            return next;
        });
    }, []);

    const executeMerge = () => {
        if (!mergeCol1 || !mergeCol2 || !mergeName) return;
        const newId = `merged_${Date.now()}`;
        setMergedCols(prev => [...prev, {
            id: newId,
            name: mergeName,
            sources: [mergeCol1, mergeCol2],
            separator: mergeSep
        }]);
        // Reset
        setMergeCol1('');
        setMergeCol2('');
        setMergeName('');
        setShowMerge(false);
    };

    // Apply Logic Pipeline
    const { processedRowData, processedColumnDefs, availableColumns } = useMemo(() => {
        // ... (Logic pipeline logic is identical to before, just inside useMemo) ...
        // 1. Base Data transformation (Merges)
        let activeRows = rows.map(r => {
            const row: any = { ...r.data, id: r.id };
            // Apply merges
            mergedCols.forEach(m => {
                const parts = m.sources.map(s => row[s]).filter(v => v !== undefined && v !== null && v !== '');
                row[m.id] = parts.join(m.separator);
            });
            return row;
        });

        // 2. Base Columns Setup
        let activeColumns = [...columns];
        mergedCols.forEach(m => {
            activeColumns.push({ id: m.id, name: m.name, type: 'text' } as any);
        });

        const hiddenIds = new Set(deletedCols);
        mergedCols.forEach(m => m.sources.forEach(s => hiddenIds.add(s)));
        activeColumns = activeColumns.filter(c => !hiddenIds.has(c.id));

        // 3. Apply Row Filters
        if (removeEmptyRows && activeColumns.length > 0) {
            activeRows = activeRows.filter(row => {
                return activeColumns.some(col => {
                    const val = row[col.id];
                    return val !== undefined && val !== null && String(val).trim() !== '';
                });
            });
        }

        // 4. Apply Column Filters
        if (hideRepeatingData) {
            activeColumns = activeColumns.filter(col => {
                const firstVal = activeRows[0]?.[col.id];
                if (!firstVal) return true;
                return !activeRows.every(r => r[col.id] === firstVal);
            });
        }

        if (removeEmptyColumns) {
            activeColumns = activeColumns.filter(col => {
                return activeRows.some(r => {
                    const val = r[col.id];
                    return val !== undefined && val !== null && String(val).trim() !== '';
                });
            });
        }

        if (hideMostlyEmptyColumns) {
            const threshold = activeRows.length * 0.2;
            activeColumns = activeColumns.filter(col => {
                const filledCount = activeRows.filter(r => r[col.id]).length;
                return filledCount >= threshold;
            });
        }

        if (removeDuplicateColumns) {
            const uniqueContentMap = new Map<string, string>();
            const colsKeep = new Set<string>();
            activeColumns.forEach(col => {
                const contentStr = activeRows.map(r => r[col.id]).join('||');
                if (!uniqueContentMap.has(contentStr)) {
                    uniqueContentMap.set(contentStr, col.id);
                    colsKeep.add(col.id);
                }
            });
            activeColumns = activeColumns.filter(c => colsKeep.has(c.id));
        }

        if (prioritizeRichColumns) {
            activeColumns.sort((a, b) => {
                const countA = activeRows.filter(r => r[a.id]).length;
                const countB = activeRows.filter(r => r[b.id]).length;
                return countB - countA;
            });
        }

        // 5. Generate Defs with Renames
        const defs: ColDef[] = activeColumns.map(col => ({
            field: col.id,
            valueGetter: (params) => params.data?.[col.id],
            headerComponent: CustomHeader,
            headerComponentParams: {
                displayName: renames[col.id] || col.name,
                column: { colId: col.id }
            },
            filter: true,
            sortable: true,
            resizable: true,
            editable: true,
            cellRenderer: (params: ICellRendererParams) => {
                const value = params.value;
                if (!value) return <span className="text-text-muted">-</span>;

                if (col.type === 'image') {
                    if (!showImages) return <span className="text-xs text-text-muted truncate block w-full" title={value}>{value}</span>;
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', overflow: 'hidden' }}>
                            <img
                                src={value}
                                alt="cell"
                                style={{ height: '24px', width: 'auto', maxWidth: '100%', objectFit: 'contain', borderRadius: '4px' }}
                                loading="lazy"
                            />
                        </div>
                    );
                }

                if (col.type === 'url') {
                    return (
                        <a
                            href={value}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-ai hover:text-white underline decoration-dotted underline-offset-2 block w-full truncate text-xs"
                            title={value}
                        >
                            {value}
                        </a>
                    );
                }

                return (
                    <div className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={String(value || '')}>
                        <span className="text-sm text-text-primary/90 font-medium">
                            {String(value ?? '')}
                        </span>
                    </div>
                );
            }
        }));

        return {
            processedRowData: activeRows,
            processedColumnDefs: defs,
            availableColumns: activeColumns
        };
    }, [columns, rows, removeEmptyRows, removeEmptyColumns, hideRepeatingData, removeDuplicateColumns, prioritizeRichColumns, showImages, hideMostlyEmptyColumns, renames, deletedCols, mergedCols]);

    useImperativeHandle(ref, () => ({
        getProcessedData: () => {
            return {
                columns: availableColumns.map(col => ({
                    id: col.id,
                    name: renames[col.id] || col.name
                })),
                rows: processedRowData
            };
        }
    }));

    const defaultColDef = useMemo<ColDef>(() => ({
        width: 180,
        minWidth: 100,
        sortable: true,
        resizable: true,
        filter: true,
        suppressHeaderMenuButton: true,
        headerClass: 'font-semibold',
    }), []);

    const resetFilters = () => {
        setRemoveEmptyRows(true);
        setRemoveEmptyColumns(true);
        setHideRepeatingData(true);
        setRemoveDuplicateColumns(true);
        setPrioritizeRichColumns(true);
        setShowImages(true);
        setHideMostlyEmptyColumns(true);
        setRenames({});
        setDeletedCols(new Set());
        setMergedCols([]);
    };

    if (columns.length === 0 || rows.length === 0) {
        return (
            <div className="card h-full flex items-center justify-center p-8 bg-background-card border border-border-subtle rounded-lg">
                <div className="text-center text-text-muted">
                    <div className="text-4xl mb-3 opacity-50">📊</div>
                    <div className="font-medium text-sm">Waiting for extracted data</div>
                    <p className="text-xs mt-1 text-text-muted/70">Run a crawl to populate results</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col gap-3">
            {/* ... Action Bar ... */}
            <div className="flex-shrink-0 flex items-center justify-between bg-background-panel p-2 rounded-lg border border-border-subtle">
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => setShowFilters(!showFilters)}
                        icon={<span>🔍</span>}
                        sx={{ fontSize: '0.75rem' }}
                    >
                        Filters
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => setShowMerge(!showMerge)}
                        icon={<CallMerge fontSize="small" sx={{ fontSize: 16 }} />}
                        sx={{ fontSize: '0.75rem' }}
                    >
                        Merge Columns
                    </Button>
                </div>

                <div className="text-[10px] text-text-muted font-mono bg-white/5 px-2 py-1 rounded">
                    {processedRowData.length} ROWS • {processedColumnDefs.length} COLS
                </div>
            </div>

            {/* Merge Panel */}
            {showMerge && (
                <div className="flex-shrink-0 bg-background-card p-4 rounded-lg border border-border-subtle animate-slide-down">
                    <h3 className="text-xs font-bold text-primary mb-3 flex items-center gap-2 uppercase tracking-wide">
                        <CallMerge fontSize="small" sx={{ fontSize: 16 }} /> Merge Two Columns
                    </h3>
                    <div className="flex items-end gap-3 flex-wrap">
                        <div className="flex-1 min-w-[160px]">
                            <label className="block text-[10px] font-medium text-text-secondary mb-1 uppercase tracking-wide">Column 1</label>
                            <select
                                className="input-field w-full text-xs py-1.5"
                                value={mergeCol1}
                                onChange={(e) => setMergeCol1(e.target.value)}
                            >
                                <option value="">Select column...</option>
                                {availableColumns.map(c => <option key={c.id} value={c.id}>{renames[c.id] || c.name}</option>)}
                            </select>
                        </div>
                        <div className="text-text-muted mb-2"><ArrowForward fontSize="small" sx={{ fontSize: 16 }} /></div>
                        <div className="flex-1 min-w-[160px]">
                            <label className="block text-[10px] font-medium text-text-secondary mb-1 uppercase tracking-wide">Column 2</label>
                            <select
                                className="input-field w-full text-xs py-1.5"
                                value={mergeCol2}
                                onChange={(e) => setMergeCol2(e.target.value)}
                            >
                                <option value="">Select column...</option>
                                {availableColumns.map(c => <option key={c.id} value={c.id}>{renames[c.id] || c.name}</option>)}
                            </select>
                        </div>
                        <div className="w-[80px]">
                            <label className="block text-[10px] font-medium text-text-secondary mb-1 uppercase tracking-wide">Separator</label>
                            <input
                                type="text"
                                className="input-field w-full text-xs py-1.5 px-2"
                                placeholder="(space)"
                                value={mergeSep}
                                onChange={(e) => setMergeSep(e.target.value)}
                            />
                        </div>
                        <div className="flex-1 min-w-[160px]">
                            <label className="block text-[10px] font-medium text-text-secondary mb-1 uppercase tracking-wide">New Name</label>
                            <input
                                type="text"
                                className="input-field w-full text-xs py-1.5 px-2"
                                placeholder="Merged Column"
                                value={mergeName}
                                onChange={(e) => setMergeName(e.target.value)}
                            />
                        </div>
                        <Button
                            variant="primary"
                            onClick={executeMerge}
                            disabled={!mergeCol1 || !mergeCol2 || !mergeName}
                            sx={{ height: 30, fontSize: '0.75rem', mb: '1px' }}
                        >
                            Merge
                        </Button>
                    </div>
                </div>
            )}

            {/* Filter Panel */}
            {showFilters && (
                <div className="flex-shrink-0 bg-background-panel/50 backdrop-blur-md p-4 rounded-xl border border-border-subtle animate-slide-down shadow-xl">
                    <div className="flex items-center justify-between mb-3 px-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Global Filters</span>
                            <div className="h-1 w-1 rounded-full bg-accent-ai shadow-[0_0_8px_rgba(34,211,238,1)]"></div>
                        </div>
                        <button
                            onClick={resetFilters}
                            className="text-[10px] font-bold text-accent-red hover:text-red-400 uppercase tracking-widest transition-colors flex items-center gap-1.5 group"
                        >
                            <span className="group-hover:rotate-180 transition-transform duration-500">↺</span> RESET TO DEFAULT
                        </button>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                        <FilterOption label="Empty Rows" active={removeEmptyRows} onClick={() => setRemoveEmptyRows(!removeEmptyRows)} icon="🧹" />
                        <FilterOption label="Empty Columns" active={removeEmptyColumns} onClick={() => setRemoveEmptyColumns(!removeEmptyColumns)} icon="🪄" />
                        <FilterOption label="Repeating Data" active={hideRepeatingData} onClick={() => setHideRepeatingData(!hideRepeatingData)} icon="🔄" />
                        <FilterOption label="No Duplicates" active={removeDuplicateColumns} onClick={() => setRemoveDuplicateColumns(!removeDuplicateColumns)} icon="👥" />
                        <FilterOption label="Rich First" active={prioritizeRichColumns} onClick={() => setPrioritizeRichColumns(!prioritizeRichColumns)} icon="📈" />
                        <FilterOption label="Show Images" active={showImages} onClick={() => setShowImages(!showImages)} icon="🖼️" />
                        <FilterOption label="Sparse Columns" active={hideMostlyEmptyColumns} onClick={() => setHideMostlyEmptyColumns(!hideMostlyEmptyColumns)} icon="🎯" />
                    </div>
                </div>
            )}

            <div
                className="flex-1 ag-theme-alpine w-full rounded-lg overflow-hidden shadow-none min-h-0"
                style={{
                    '--ag-header-height': '36px',
                    '--ag-row-height': '32px'
                } as any}
            >
                <AgGridReact
                    rowData={processedRowData}
                    columnDefs={processedColumnDefs}
                    defaultColDef={defaultColDef}
                    theme="legacy"
                    pagination={true}
                    paginationPageSize={50}
                    rowSelection={{ mode: 'multiRow' }}
                    animateRows={true}
                    enableCellTextSelection={true}
                    domLayout='normal'
                    context={{ onRenameColumn, onDeleteColumn }}
                />
            </div>
            <style>{/* ... style omitted ... */}</style>
            <style>{`
                .ag-theme-alpine {
                    --ag-background-color: #020617;
                    --ag-foreground-color: #E5E7EB;
                    --ag-header-background-color: #020617;
                    --ag-header-foreground-color: #9CA3AF;
                    --ag-border-color: rgba(148, 163, 184, 0.12);
                    --ag-row-hover-color: rgba(255, 255, 255, 0.04);
                    --ag-row-border-color: rgba(148, 163, 184, 0.08);
                    --ag-odd-row-background-color: #020617;
                    --ag-even-row-background-color: rgba(255, 255, 255, 0.015);
                    --ag-input-focus-border-color: #22D3EE;
                    --ag-font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    --ag-font-size: 12.5px;
                    --ag-header-height: 36px;
                    --ag-row-height: 32px;
                    --ag-selected-row-background-color: rgba(37, 99, 235, 0.12);
                    --ag-cell-horizontal-padding: 8px;
                    
                    /* Custom Vars */
                    --custom-grid-border: 1px solid rgba(148, 163, 184, 0.12);
                }
                
                /* Grid Container */
                .ag-root-wrapper {
                    border: var(--custom-grid-border);
                    border-radius: 8px;
                    background-color: var(--ag-background-color);
                }

                /* Header Styling */
                .ag-header {
                    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
                    font-size: 12px;
                    font-weight: 500;
                    letter-spacing: 0.01em;
                    text-transform: none;
                }

                .ag-header-cell:hover {
                    background-color: rgba(255, 255, 255, 0.03);
                }
                
                .ag-header-icon {
                    color: #64748B;
                }
                
                /* Row Styling */
                .ag-row {
                    border-bottom-color: var(--ag-row-border-color);
                }

                .ag-row-selected {
                    border-left: 2px solid #2563EB !important;
                }
                
                /* Cell Styling */
                .ag-cell {
                    line-height: 1.4;
                    display: flex;
                    align-items: center;
                    overflow: hidden !important;
                }

                .ag-cell-focus {
                    border: none !important;
                    outline: 1px solid rgba(34, 211, 238, 0.4) !important;
                    outline-offset: -1px;
                    z-index: 10;
                }

                /* Scrollbars */
                .ag-body-viewport::-webkit-scrollbar {
                    width: 8px;
                    height: 8px;
                }

                .ag-body-viewport::-webkit-scrollbar-track {
                    background: transparent;
                }

                .ag-body-viewport::-webkit-scrollbar-thumb {
                    background-color: #334155;
                    border-radius: 4px;
                    border: 2px solid #020617;
                }

                .ag-body-viewport::-webkit-scrollbar-thumb:hover {
                    background-color: #475569;
                }

                /* Pagination */
                .ag-paging-panel {
                    border-top: 1px solid rgba(148, 163, 184, 0.12);
                    font-size: 12px;
                    color: #9CA3AF;
                }
            `}</style>
        </div>
    );
});

export default DataTable;

function FilterOption({ label, active, onClick, icon }: any) {
    return (
        <button
            onClick={onClick}
            className={`
                flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-semibold transition-all duration-300 select-none group relative overflow-hidden
                ${active
                    ? 'bg-accent-ai/20 text-accent-ai border border-accent-ai/40 shadow-[0_0_15px_-3px_rgba(34,211,238,0.25)]'
                    : 'bg-white/5 text-text-muted hover:bg-white/[0.08] border border-white/5 hover:border-white/10'}
            `}
        >
            <div className="flex items-center gap-2.5 z-10">
                <span className={`text-[13px] transition-all duration-300 ${active ? 'scale-110 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]' : 'grayscale opacity-60 group-hover:grayscale-0 group-hover:opacity-100'}`}>
                    {icon}
                </span>
                <span className={`truncate ${active ? 'text-white' : ''}`}>{label}</span>
            </div>

            <div className="flex-shrink-0 z-10">
                {active ? (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-accent-ai text-black shadow-[0_0_8px_rgba(34,211,238,0.5)] scale-100 animate-in zoom-in-50 duration-300">
                        <Check sx={{ fontSize: 12 }} />
                    </div>
                ) : (
                    <div className="h-4 w-4 rounded-full border-2 border-white/10 group-hover:border-white/20 transition-all duration-300" />
                )}
            </div>

            {/* Animated hover background effect */}
            {!active && (
                <div className="absolute inset-0 bg-gradient-to-r from-accent-ai/0 via-accent-ai/5 to-accent-ai/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            )}
        </button>
    );
}
