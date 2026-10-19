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
import type { Column, Row, TypedColumnDef } from '@/shared/types/database';
import { detectType } from '@/shared/transforms/detect';
import ColumnCleanDialog from './ColumnCleanDialog';
import { GitMerge, ArrowRight, Filter, RotateCcw, Table2, Sparkles } from 'lucide-react';
import { Button, Chip, Select, Text, TextField, Tooltip } from '../../ui';
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
    rows: Row[];
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
            <div className="flex h-full flex-col items-center justify-center rounded-card border border-line bg-surface p-8 text-center" role="status" aria-label="No data available">
                <Table2 size={36} className="mb-2 text-ink-3" />
                <Text weight="semibold">{t('empty.waiting')}</Text>
                <Text size="caption" tone="muted" className="mt-1">{t('empty.runCrawl')}</Text>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full flex-col gap-3">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surface px-2 py-1.5" role="toolbar" aria-label="Table actions">
                <div className="flex flex-wrap items-center gap-1">
                    <Tooltip title={t('toolbar.filterTooltip')}>
                        <Button size="sm" variant="ghost" icon={<Filter />} onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters} aria-controls="filter-panel"
                            className={showFilters ? 'bg-ink/7 text-ink' : undefined}>
                            {t('toolbar.filters')}{activeFilterCount > 0 && <Chip tone="brand" className="ml-0.5">{t('toolbar.filtersActive', { count: activeFilterCount })}</Chip>}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t('toolbar.mergeTooltip')}>
                        <Button size="sm" variant="ghost" icon={<GitMerge />} onClick={() => setShowMerge(!showMerge)} aria-expanded={showMerge} aria-controls="merge-panel"
                            className={showMerge ? 'bg-ink/7 text-ink' : undefined}>
                            {t('toolbar.mergeColumns')}
                        </Button>
                    </Tooltip>
                    <Tooltip title="Detect prices, numbers, dates, ratings and URLs, and add a clean typed column next to each (the raw column stays)">
                        <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={autoTypeColumns}>Auto-type</Button>
                    </Tooltip>
                </div>
                <Tooltip title={t('toolbar.statusTooltip')}>
                    <span className="rounded-full bg-ink/6 px-3 py-1 font-mono text-caption text-ink-2" role="status" aria-live="polite"
                        aria-label={`${processedRowData.length} rows, ${processedColumnDefs.length} columns after filtering`}>
                        {t('toolbar.status', { rows: processedRowData.length, cols: processedColumnDefs.length })}
                    </span>
                </Tooltip>
            </div>

            {showMerge && (
                <div id="merge-panel" role="form" aria-label={t('merge.title')} className="shrink-0 rounded-card border border-line bg-surface p-4 animate-slide-up">
                    <h3 className="m-0 mb-3 flex items-center gap-2 text-small font-bold text-ink"><GitMerge size={15} /> {t('merge.title')}</h3>
                    <div className="flex flex-wrap items-end gap-3">
                        <Select size="sm" className="min-w-[160px] flex-1" label={t('merge.column1')} value={mergeCol1} onChange={setMergeCol1} options={[{ value: '', label: t('merge.selectColumn') }, ...availableColumns.map(c => ({ value: c.id, label: renames[c.id] || c.name }))]} />
                        <ArrowRight size={16} className="mb-2 text-ink-3" />
                        <Select size="sm" className="min-w-[160px] flex-1" label={t('merge.column2')} value={mergeCol2} onChange={setMergeCol2} options={[{ value: '', label: t('merge.selectColumn') }, ...availableColumns.map(c => ({ value: c.id, label: renames[c.id] || c.name }))]} />
                        <TextField size="sm" className="w-[90px]" label={t('merge.separator')} placeholder={t('merge.separatorPlaceholder')} value={mergeSep} onChange={e => setMergeSep(e.target.value)} />
                        <TextField size="sm" className="min-w-[160px] flex-1" label={t('merge.newName')} placeholder={t('merge.newNamePlaceholder')} value={mergeName} onChange={e => setMergeName(e.target.value)} />
                        <Button size="sm" variant="primary" onClick={executeMerge} disabled={!mergeCol1 || !mergeCol2 || !mergeName}>{t('merge.button')}</Button>
                    </div>
                    <Text size="caption" tone="faint" className="mt-2">{t('merge.tip')}</Text>
                </div>
            )}

            {showFilters && (
                <div id="filter-panel" role="region" aria-label={t('filters.title')} className="shrink-0 rounded-card border border-line bg-surface p-4 animate-slide-up">
                    <div className="mb-3 flex items-center justify-between">
                        <Text size="small" weight="bold">{t('filters.title')}</Text>
                        <Tooltip title={t('filters.resetTooltip')}>
                            <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={resetFilters} aria-label={t('filters.resetTooltip')}>{t('filters.resetToDefault')}</Button>
                        </Tooltip>
                    </div>
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label={t('filters.title')}>
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
                className="ag-theme-alpine min-h-0 w-full flex-1 overflow-hidden rounded-card border border-line shadow-none"
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
