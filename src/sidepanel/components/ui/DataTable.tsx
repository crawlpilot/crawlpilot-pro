import { useMemo, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { AgGridReact } from 'ag-grid-react';
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
import type { Column, TableRow, TypedColumnDef } from '@/shared/types/database';
import { detectType } from '@/shared/transforms/detect';
import ColumnCleanDialog from './ColumnCleanDialog';
import { GitMerge, ArrowRight, Filter, Table2, Sparkles } from 'lucide-react';
import { Tooltip } from '@mui/material';
import Button from './Button';
import { ColumnHeader } from './data-table/ColumnHeader';
import { FilterOption } from './data-table/FilterOption';
import { MarkdownPreview } from './data-table/MarkdownPreview';
import { renderCell } from './data-table/renderCell';
import { GRID_CSS } from './data-table/gridTheme';
import { dropEmptyRows, explodeJsonColumns, exportData, MergeDefinition, typedColumnsOf, visibleColumns, withDerivedColumns } from './data-table/pipeline';

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
    getProcessedData: () => { columns: { id: string, name: string, type?: string }[], rows: any[] };
}

interface DataTableProps {
    columns: Column[];
    rows: TableRow[];
    defaultHideMostlyEmptyColumns?: boolean;
    initialMergedCols?: MergeDefinition[];
    initialTypedCols?: TypedColumnDef[];
    onTypedColumnsChanged?: (defs: TypedColumnDef[]) => void;
    onColumnRenamed?: (colId: string, newName: string) => void;
    onColumnDeleted?: (colId: string) => void;
    onColumnsMerged?: (merge: MergeDefinition) => void;
}

const DataTable = forwardRef<DataTableRef, DataTableProps>(({ columns, rows, defaultHideMostlyEmptyColumns = true, initialMergedCols, initialTypedCols, onTypedColumnsChanged, onColumnRenamed, onColumnDeleted, onColumnsMerged }, ref) => {
    const { t } = useTranslation('dataTable');

    // Filter states
    const [showFilters, setShowFilters] = useState(false);
    const [showMerge, setShowMerge] = useState(false);

    // Feature States
    const [removeEmptyRows, setRemoveEmptyRows] = useState(true);
    const [removeEmptyColumns, setRemoveEmptyColumns] = useState(true);
    const [hideRepeatingData, setHideRepeatingData] = useState(true);
    const [removeDuplicateColumns, setRemoveDuplicateColumns] = useState(true);
    const [showImages, setShowImages] = useState(true);
    const [hideMostlyEmptyColumns, setHideMostlyEmptyColumns] = useState(defaultHideMostlyEmptyColumns);

    // Column Management States
    const [renames, setRenames] = useState<Record<string, string>>({});
    const [deletedCols, setDeletedCols] = useState<Set<string>>(new Set());
    const [mergedCols, setMergedCols] = useState<MergeDefinition[]>(initialMergedCols || []);
    const [typedCols, setTypedCols] = useState<TypedColumnDef[]>(initialTypedCols || []);
    const [cleanTarget, setCleanTarget] = useState<string | null>(null);

    // Merge UI States
    const [mergeCol1, setMergeCol1] = useState('');
    const [mergeCol2, setMergeCol2] = useState('');
    const [mergeName, setMergeName] = useState('');
    const [mergeSep, setMergeSep] = useState(' ');

    // Markdown preview modal
    const [mdPreview, setMdPreview] = useState<{ content: string; title: string } | null>(null);

    // Callbacks for Context
    const onRenameColumn = useCallback((colId: string, newName: string) => {
        setRenames(prev => ({ ...prev, [colId]: newName }));
        onColumnRenamed?.(colId, newName);
    }, [onColumnRenamed]);

    const onDeleteColumn = useCallback((colId: string) => {
        setDeletedCols(prev => {
            const next = new Set(prev);
            next.add(colId);
            return next;
        });
        onColumnDeleted?.(colId);
    }, [onColumnDeleted]);

    const onCleanColumn = useCallback((colId: string) => setCleanTarget(colId), []);

    const updateTypedCols = useCallback((next: TypedColumnDef[]) => {
        setTypedCols(next);
        onTypedColumnsChanged?.(next);
    }, [onTypedColumnsChanged]);

    const executeMerge = () => {
        if (!mergeCol1 || !mergeCol2 || !mergeName) return;
        const merge: MergeDefinition = { id: `merged_${Date.now()}`, name: mergeName, sources: [mergeCol1, mergeCol2], separator: mergeSep };
        setMergedCols(prev => [...prev, merge]);
        onColumnsMerged?.(merge);
        // Reset
        setMergeCol1('');
        setMergeCol2('');
        setMergeName('');
        setShowMerge(false);
    };

    // The view, step by step (pipeline.ts); each step re-runs only when its inputs change.
    const { displayRows, displayColumns } = useMemo(() => explodeJsonColumns(rows, columns), [rows, columns]);
    const { baseRows, baseColumns } = useMemo(
        () => withDerivedColumns(displayRows, displayColumns, mergedCols, typedCols, deletedCols),
        [displayRows, displayColumns, mergedCols, typedCols, deletedCols]);
    const filteredRows = useMemo(
        () => (removeEmptyRows ? dropEmptyRows(baseRows, baseColumns) : baseRows),
        [baseRows, baseColumns, removeEmptyRows]);
    const activeColumns = useMemo(
        () => visibleColumns(baseColumns, filteredRows, { hideRepeatingData, removeEmptyColumns, hideMostlyEmptyColumns, removeDuplicateColumns }),
        [baseColumns, filteredRows, hideRepeatingData, removeEmptyColumns, hideMostlyEmptyColumns, removeDuplicateColumns]);

    // Stage 4: Column defs (depends on activeColumns + renames + showImages)
    const processedColumnDefs = useMemo(() => {
        const defs: ColDef[] = activeColumns.map(col => ({
            field: col.id,
            valueGetter: (params) => params.data?.[col.id],
            headerComponent: ColumnHeader,
            headerComponentParams: {
                displayName: renames[col.id] || col.name,
                column: { colId: col.id }
            },
            filter: col.type === 'number' ? 'agNumberColumnFilter' : true,
            sortable: true,
            resizable: true,
            editable: true,
            cellRenderer: (params: ICellRendererParams) =>
                renderCell(params.value, col, showImages, content => setMdPreview({ content, title: renames[col.id] || col.name }))
        }));
        return defs;
    }, [activeColumns, renames, showImages]);

    // Derive final outputs for external consumption
    const processedRowData = filteredRows;
    const availableColumns = activeColumns;

    useImperativeHandle(ref, () => ({
        // Export uses the stored (unexploded) rows, without the hidden raw-table columns.
        getProcessedData: () => exportData(columns, rows, renames, mergedCols, typedCols),
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

    const autoTypeColumns = () => {
        const typedSources = new Set(typedCols.map(d => d.source));
        const derivedIds = new Set([...typedColumnsOf(typedCols).map(c => c.id), ...mergedCols.map(m => m.id)]);
        const added: TypedColumnDef[] = [];
        for (const col of activeColumns) {
            if (typedSources.has(col.id) || derivedIds.has(col.id)) continue;
            if (['image', 'image_array', 'markdown', 'json', 'tabledata'].includes(col.type)) continue;
            if (col.id === 'recordId' || col.id === 'source_url') continue;
            const values = baseRows.slice(0, 300).map(r => r[col.id]);
            const d = detectType(values, renames[col.id] || col.name);
            if (d.type === 'text' || d.type === 'url') continue;
            if (values.every(v => typeof v === 'number')) continue; // already numeric
            added.push({ id: `typed_${col.id}_${Date.now()}`, name: `${renames[col.id] || col.name} (${d.label})`, source: col.id, type: d.type, ops: [] });
        }
        if (added.length === 0) {
            alert('No new price, number, date or rating columns found.');
            return;
        }
        updateTypedCols([...typedCols, ...added]);
    };

    const resetFilters = () => {
        setRemoveEmptyRows(true);
        setRemoveEmptyColumns(true);
        setHideRepeatingData(true);
        setRemoveDuplicateColumns(true);
        setShowImages(true);
        setHideMostlyEmptyColumns(defaultHideMostlyEmptyColumns);
        setRenames({});
        setDeletedCols(new Set());
        setMergedCols([]);
    };

    const activeFilterCount = [removeEmptyRows, removeEmptyColumns, hideRepeatingData, removeDuplicateColumns, showImages, hideMostlyEmptyColumns].filter(Boolean).length;

    if (columns.length === 0 || rows.length === 0) {
        return (
            <div className="card h-full flex items-center justify-center p-8 bg-background-card border border-border-subtle rounded-lg" role="status" aria-label="No data available">
                <div className="text-center text-text-muted">
                    <Table2 size={40} style={{ opacity: 0.5, marginBottom: 4 }} />
                    <div className="font-medium text-sm">{t('empty.waiting')}</div>
                    <p className="text-xs mt-1 text-text-muted/70">{t('empty.runCrawl')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col gap-3">
            {/* Action Bar */}
            <div className="flex-shrink-0 flex items-center justify-between bg-background-panel px-3 py-2 rounded-lg border border-border-subtle" role="toolbar" aria-label="Table actions">
                <div className="flex items-center gap-3">
                    <Tooltip title={t('toolbar.filterTooltip')}>
                        <span>
                            <Button
                                variant="ghost"
                                onClick={() => setShowFilters(!showFilters)}
                                icon={<Filter size={16} />}
                                sx={{ fontSize: '0.75rem' }}
                                aria-expanded={showFilters}
                                aria-controls="filter-panel"
                            >
                                {t('toolbar.filters')}{activeFilterCount > 0 && <span className="ml-1.5 text-[10px] bg-accent-ai/20 text-accent-ai px-1.5 py-0.5 rounded-full font-bold">{t('toolbar.filtersActive', { count: activeFilterCount })}</span>}
                            </Button>
                        </span>
                    </Tooltip>
                    <Tooltip title={t('toolbar.mergeTooltip')}>
                        <span>
                            <Button
                                variant="ghost"
                                onClick={() => setShowMerge(!showMerge)}
                                icon={<GitMerge size={16} />}
                                sx={{ fontSize: '0.75rem' }}
                                aria-expanded={showMerge}
                                aria-controls="merge-panel"
                            >
                                {t('toolbar.mergeColumns')}
                            </Button>
                        </span>
                    </Tooltip>
                    <Tooltip title="Detect prices, numbers, dates, ratings and URLs, and add a clean typed column next to each (the raw column stays)">
                        <span>
                            <Button variant="ghost" onClick={autoTypeColumns} icon={<Sparkles size={16} />} sx={{ fontSize: '0.75rem' }}>
                                Auto-type
                            </Button>
                        </span>
                    </Tooltip>
                </div>

                <Tooltip title={t('toolbar.statusTooltip')}>
                    <div className="text-xs text-text-muted font-mono bg-white/5 px-3 py-1.5 rounded border-l-2 border-accent-ai/30" role="status" aria-live="polite" aria-label={`${processedRowData.length} rows, ${processedColumnDefs.length} columns after filtering`}>
                        {t('toolbar.status', { rows: processedRowData.length, cols: processedColumnDefs.length })}
                    </div>
                </Tooltip>
            </div>

            {/* Merge Panel */}
            {showMerge && (
                <div id="merge-panel" role="form" aria-label={t('merge.title')} className="flex-shrink-0 bg-background-card p-4 rounded-lg border border-border-subtle animate-slide-down">
                    <h3 className="text-xs font-bold text-primary mb-3 flex items-center gap-2 uppercase tracking-wide">
                        <GitMerge size={16} /> {t('merge.title')}
                    </h3>
                    <div className="flex items-end gap-3 flex-wrap">
                        <div className="flex-1 min-w-[160px]">
                            <label className="block text-xs font-medium text-text-secondary mb-1 uppercase tracking-wide">{t('merge.column1')}</label>
                            <select
                                className="input-field w-full text-xs py-1.5"
                                value={mergeCol1}
                                onChange={(e) => setMergeCol1(e.target.value)}
                            >
                                <option value="">{t('merge.selectColumn')}</option>
                                {availableColumns.map(c => <option key={c.id} value={c.id}>{renames[c.id] || c.name}</option>)}
                            </select>
                        </div>
                        <div className="text-text-muted mb-2"><ArrowRight size={16} /></div>
                        <div className="flex-1 min-w-[160px]">
                            <label className="block text-xs font-medium text-text-secondary mb-1 uppercase tracking-wide">{t('merge.column2')}</label>
                            <select
                                className="input-field w-full text-xs py-1.5"
                                value={mergeCol2}
                                onChange={(e) => setMergeCol2(e.target.value)}
                            >
                                <option value="">{t('merge.selectColumn')}</option>
                                {availableColumns.map(c => <option key={c.id} value={c.id}>{renames[c.id] || c.name}</option>)}
                            </select>
                        </div>
                        <div className="w-[80px]">
                            <label className="block text-xs font-medium text-text-secondary mb-1 uppercase tracking-wide">{t('merge.separator')}</label>
                            <input
                                type="text"
                                className="input-field w-full text-xs py-1.5 px-2"
                                placeholder={t('merge.separatorPlaceholder')}
                                value={mergeSep}
                                onChange={(e) => setMergeSep(e.target.value)}
                            />
                        </div>
                        <div className="flex-1 min-w-[160px]">
                            <label className="block text-xs font-medium text-text-secondary mb-1 uppercase tracking-wide">{t('merge.newName')}</label>
                            <input
                                type="text"
                                className="input-field w-full text-xs py-1.5 px-2"
                                placeholder={t('merge.newNamePlaceholder')}
                                value={mergeName}
                                onChange={(e) => setMergeName(e.target.value)}
                            />
                        </div>
                        <Button
                            variant="primary"
                            onClick={executeMerge}
                            disabled={!mergeCol1 || !mergeCol2 || !mergeName}
                            sx={{ height: 32, fontSize: '0.75rem', mb: '1px' }}
                            aria-label={t('merge.button')}
                        >
                            {t('merge.button')}
                        </Button>
                    </div>
                    <p className="text-xs text-text-muted/60 mt-2">{t('merge.tip')}</p>
                </div>
            )}

            {/* Filter Panel */}
            {showFilters && (
                <div id="filter-panel" role="region" aria-label={t('filters.title')} className="flex-shrink-0 bg-background-panel/50 backdrop-blur-md p-4 rounded-xl border border-border-subtle animate-slide-down shadow-xl">
                    <div className="flex items-center justify-between mb-3 px-1">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-text-muted uppercase tracking-widest">{t('filters.title')}</span>
                            <div className="h-1 w-1 rounded-full bg-accent-ai shadow-[0_0_8px_rgba(34,211,238,1)]"></div>
                        </div>
                        <Tooltip title={t('filters.resetTooltip')}>
                            <button
                                onClick={resetFilters}
                                aria-label={t('filters.resetTooltip')}
                                className="text-xs font-bold text-accent-red hover:text-red-400 uppercase tracking-widest transition-colors flex items-center gap-1.5 group focus-visible:ring-2 focus-visible:ring-accent-ai/50 focus-visible:outline-none rounded px-1"
                            >
                                <span className="group-hover:rotate-180 transition-transform duration-500">↺</span> {t('filters.resetToDefault')}
                            </button>
                        </Tooltip>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5" role="group" aria-label={t('filters.title')}>
                        <FilterOption label={t('filters.emptyRows')} active={removeEmptyRows} onClick={() => setRemoveEmptyRows(!removeEmptyRows)} icon="🧹" description={t('filters.emptyRowsDesc')} />
                        <FilterOption label={t('filters.emptyColumns')} active={removeEmptyColumns} onClick={() => setRemoveEmptyColumns(!removeEmptyColumns)} icon="🪄" description={t('filters.emptyColumnsDesc')} />
                        <FilterOption label={t('filters.repeatingData')} active={hideRepeatingData} onClick={() => setHideRepeatingData(!hideRepeatingData)} icon="🔄" description={t('filters.repeatingDataDesc')} />
                        <FilterOption label={t('filters.noDuplicates')} active={removeDuplicateColumns} onClick={() => setRemoveDuplicateColumns(!removeDuplicateColumns)} icon="👥" description={t('filters.noDuplicatesDesc')} />
                        <FilterOption label={t('filters.showImages')} active={showImages} onClick={() => setShowImages(!showImages)} icon="🖼️" description={t('filters.showImagesDesc')} />
                        <FilterOption label={t('filters.sparseColumns')} active={hideMostlyEmptyColumns} onClick={() => setHideMostlyEmptyColumns(!hideMostlyEmptyColumns)} icon="🎯" description={t('filters.sparseColumnsDesc')} />
                    </div>
                </div>
            )}

            <div
                className="flex-1 ag-theme-alpine w-full rounded-lg overflow-hidden shadow-none min-h-0"
                style={{
                    '--ag-header-height': '44px',
                    '--ag-row-height': '40px'
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
                    animateRows={false}
                    suppressScrollOnNewData={true}
                    enableCellTextSelection={true}
                    domLayout='normal'
                    context={{ onRenameColumn, onDeleteColumn, onCleanColumn }}
                />
            </div>
            {cleanTarget && (() => {
                const existing = typedCols.find(d => d.id === cleanTarget || `${d.id}__currency` === cleanTarget);
                const sourceId = existing ? existing.source : cleanTarget;
                const sourceCol = baseColumns.find(c => c.id === sourceId) || displayColumns.find(c => c.id === sourceId);
                return (
                    <ColumnCleanDialog
                        open
                        sourceId={sourceId}
                        sourceName={renames[sourceId] || sourceCol?.name || sourceId}
                        values={baseRows.slice(0, 500).map(r => r[sourceId])}
                        baseUrl={typeof baseRows[0]?.source_url === 'string' ? baseRows[0].source_url : undefined}
                        existing={existing}
                        onClose={() => setCleanTarget(null)}
                        onRemove={(id) => { updateTypedCols(typedCols.filter(d => d.id !== id)); setCleanTarget(null); }}
                        onApply={(def) => {
                            updateTypedCols(existing ? typedCols.map(d => (d.id === def.id ? def : d)) : [...typedCols, def]);
                            setCleanTarget(null);
                        }}
                    />
                );
            })()}
            {mdPreview && <MarkdownPreview preview={mdPreview} onClose={() => setMdPreview(null)} />}

            <style>{GRID_CSS}</style>
        </div>
    );
});

export default DataTable;
