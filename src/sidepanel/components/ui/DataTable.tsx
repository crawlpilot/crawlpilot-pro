import { useMemo, useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { AgGridReact } from 'ag-grid-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
import { Edit, Trash2, GitMerge, X, Check, ArrowRight, Filter, Table2, FileText } from 'lucide-react';
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
    getProcessedData: () => { columns: { id: string, name: string, type?: string }[], rows: any[] };
}

type MergeDefinition = { id: string; name: string; sources: string[]; separator: string };

interface DataTableProps {
    columns: Column[];
    rows: TableRow[];
    defaultHideMostlyEmptyColumns?: boolean;
    initialMergedCols?: MergeDefinition[];
    onColumnRenamed?: (colId: string, newName: string) => void;
    onColumnDeleted?: (colId: string) => void;
    onColumnsMerged?: (merge: MergeDefinition) => void;
}

// Custom Header Component
const CustomHeader = (props: any) => {
    const { t } = useTranslation('dataTable');
    const [isEditing, setIsEditing] = useState(false);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
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
        props.context.onDeleteColumn(props.column.colId);
        setIsConfirmingDelete(false);
    };

    return (
        <div className="flex items-center justify-between w-full group" role="columnheader">
            {isEditing ? (
                <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
                    <input
                        type="text"
                        value={tempName}
                        onChange={(e) => setTempName(e.target.value)}
                        className="w-full text-xs px-2 py-1 border rounded bg-white text-gray-900"
                        autoFocus
                        aria-label={`${t('header.rename')} ${props.displayName}`}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') onSave();
                            if (e.key === 'Escape') setIsEditing(false);
                        }}
                    />
                    <Tooltip title={t('header.saveName')}>
                        <IconButton size="small" onClick={onSave} aria-label={t('header.saveName')} sx={{ color: 'success.main', p: 0.5 }}>
                            <Check size={14} />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t('header.cancel')}>
                        <IconButton size="small" onClick={() => setIsEditing(false)} aria-label={t('header.cancel')} sx={{ color: 'error.main', p: 0.5 }}>
                            <X size={14} />
                        </IconButton>
                    </Tooltip>
                </div>
            ) : isConfirmingDelete ? (
                <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs text-accent-red font-semibold truncate">{t('header.deletePrompt')}</span>
                    <Tooltip title={t('header.confirmDelete')}>
                        <IconButton size="small" onClick={onDelete} aria-label={`${t('header.confirmDelete')} ${props.displayName}`} sx={{ color: 'error.main', p: 0.5 }}>
                            <Check size={14} />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t('header.cancel')}>
                        <IconButton size="small" onClick={() => setIsConfirmingDelete(false)} aria-label={t('header.cancel')} sx={{ color: 'text.secondary', p: 0.5 }}>
                            <X size={14} />
                        </IconButton>
                    </Tooltip>
                </div>
            ) : (
                <div className="flex items-center justify-between w-full">
                    <span className="truncate font-semibold text-gray-700 dark:text-gray-300" title={props.displayName}>{props.displayName}</span>
                    <div className="flex items-center opacity-30 group-hover:opacity-100 transition-opacity ml-1">
                        <Tooltip title={t('header.rename')}>
                            <IconButton
                                size="small"
                                aria-label={`${t('header.rename')} ${props.displayName}`}
                                onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                                sx={{ p: 0.5, color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                            >
                                <Edit size={14} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={t('header.delete')}>
                            <IconButton
                                size="small"
                                aria-label={`${t('header.delete')} ${props.displayName}`}
                                onClick={(e) => { e.stopPropagation(); setIsConfirmingDelete(true); }}
                                sx={{ p: 0.5, color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                            >
                                <Trash2 size={14} />
                            </IconButton>
                        </Tooltip>
                    </div>
                </div>
            )}
        </div>
    );
};

function parseJsonForExplosion(val: any): any[][] {
    if (typeof val !== 'string') return [];
    try {
        const parsed = JSON.parse(val);
        if (!Array.isArray(parsed) || parsed.length === 0) return [];
        if (Array.isArray(parsed[0])) return parsed as any[][];
        return parsed.map((v: any) => [v]);
    } catch { return []; }
}

const DataTable = forwardRef<DataTableRef, DataTableProps>(({ columns, rows, defaultHideMostlyEmptyColumns = true, initialMergedCols, onColumnRenamed, onColumnDeleted, onColumnsMerged }, ref) => {
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

    // === STAGE 0: Explode JSON-consolidated table columns into individual rows ===
    const { displayRows, displayColumns } = useMemo(() => {
        const jsonCols = columns.filter(c => (c as any).type === 'json' && !(c as any).hidden);
        if (jsonCols.length === 0) {
            return {
                displayRows: rows,
                displayColumns: columns.filter(c => (c as any).type !== 'tabledata')
            };
        }

        // Max sub-array length per JSON column (determines how many position columns to create)
        const colMaxLen = new Map<string, number>();
        jsonCols.forEach(col => {
            let max = 0;
            rows.forEach(row => {
                const subs = parseJsonForExplosion(row.data[col.id]);
                subs.forEach((sub: any[]) => { max = Math.max(max, sub.length); });
                if (subs.length > 0) max = Math.max(max, 1);
            });
            colMaxLen.set(col.id, max || 1);
        });

        // Build position columns to replace JSON + tabledata columns
        const posCols: Column[] = [];
        jsonCols.forEach(col => {
            const count = colMaxLen.get(col.id) ?? 1;
            for (let p = 0; p < count; p++) {
                posCols.push({
                    id: `${col.id}__pos${p}`,
                    originalId: `${col.id}__pos${p}`,
                    name: count === 1 ? col.name : `${col.name} ${p + 1}`,
                    type: 'text' as any,
                    elementId: (col as any).elementId,
                    elementName: (col as any).elementName,
                    group: (col as any).group
                } as Column);
            }
        });

        const displayColumns: Column[] = [
            ...columns.filter(c => (c as any).type !== 'json' && (c as any).type !== 'tabledata'),
            ...posCols
        ];

        const jsonColIds = new Set(jsonCols.map(c => c.id));
        const tabledataColIds = new Set(columns.filter(c => (c as any).type === 'tabledata').map(c => c.id));
        const displayRows: TableRow[] = [];

        rows.forEach(row => {
            const subArrayMap = new Map<string, any[][]>();
            jsonCols.forEach(col => {
                subArrayMap.set(col.id, parseJsonForExplosion(row.data[col.id]));
            });

            const maxSubRows = Math.max(1, ...Array.from(subArrayMap.values()).map(a => a.length));

            for (let i = 0; i < maxSubRows; i++) {
                const data: Record<string, any> = {};

                Object.keys(row.data).forEach(key => {
                    if (!jsonColIds.has(key) && !tabledataColIds.has(key)) {
                        data[key] = i === 0 ? row.data[key] : null;
                    }
                });

                jsonCols.forEach(col => {
                    const subs = subArrayMap.get(col.id) ?? [];
                    const subRow = subs[i] ?? [];
                    const count = colMaxLen.get(col.id) ?? 1;
                    for (let p = 0; p < count; p++) {
                        data[`${col.id}__pos${p}`] = subRow[p] ?? null;
                    }
                });

                displayRows.push({
                    ...row,
                    id: row.id !== undefined ? row.id * 100000 + i : undefined,
                    data
                });
            }
        });

        return { displayRows, displayColumns };
    }, [rows, columns]);

    // === SPLIT MEMO PIPELINE (Step 3.1) ===
    // Stage 1: Base data + merges (only re-runs on rows/mergedCols/deletedCols change)
    const { baseRows, baseColumns } = useMemo(() => {
        const activeRows = displayRows.map(r => {
            const row: any = { ...r.data, id: r.id };
            mergedCols.forEach(m => {
                const parts = m.sources.map(s => row[s]).filter(v => v !== undefined && v !== null && v !== '');
                row[m.id] = parts.join(m.separator);
            });
            return row;
        });

        let activeCols = [...displayColumns];
        mergedCols.forEach(m => {
            activeCols.push({ id: m.id, name: m.name, type: 'text' } as any);
        });

        const hiddenIds = new Set(deletedCols);
        mergedCols.forEach(m => m.sources.forEach(s => hiddenIds.add(s)));
        activeCols = activeCols.filter(c => !hiddenIds.has(c.id));

        return { baseRows: activeRows, baseColumns: activeCols };
    }, [columns, rows, mergedCols, deletedCols]);

    // Stage 2: Row filtering (depends on baseRows + row filter toggles)
    const filteredRows = useMemo(() => {
        let result = baseRows;
        if (removeEmptyRows && baseColumns.length > 0) {
            result = result.filter(row => {
                return baseColumns.some(col => {
                    const val = row[col.id];
                    return val !== undefined && val !== null && String(val).trim() !== '';
                });
            });
        }
        return result;
    }, [baseRows, baseColumns, removeEmptyRows]);

    // Stage 3: Column filtering + sorting (depends on filteredRows + column filter toggles)
    const activeColumns = useMemo(() => {
        let activeCols = [...baseColumns];

        if (hideRepeatingData) {
            const nonRepeating = activeCols.filter(col => {
                const firstVal = filteredRows[0]?.[col.id];
                if (!firstVal) return true;
                return !filteredRows.every(r => r[col.id] === firstVal);
            });
            // Don't hide ALL columns — if filter would remove everything, keep them
            if (nonRepeating.length > 0) {
                activeCols = nonRepeating;
            }
        }

        if (removeEmptyColumns) {
            activeCols = activeCols.filter(col => {
                return filteredRows.some(r => {
                    const val = r[col.id];
                    return val !== undefined && val !== null && String(val).trim() !== '';
                });
            });
        }

        if (hideMostlyEmptyColumns) {
            const threshold = filteredRows.length * 0.2;
            const denseEnough = activeCols.filter(col => {
                const filledCount = filteredRows.filter(r => r[col.id]).length;
                return filledCount >= threshold;
            });
            // Don't hide ALL columns — if filter would remove everything, keep them
            if (denseEnough.length > 0) {
                activeCols = denseEnough;
            }
        }

        if (removeDuplicateColumns) {
            const uniqueContentMap = new Map<string, string>();
            const colsKeep = new Set<string>();
            activeCols.forEach(col => {
                const contentStr = filteredRows.map(r => r[col.id]).join('||');
                if (!uniqueContentMap.has(contentStr)) {
                    uniqueContentMap.set(contentStr, col.id);
                    colsKeep.add(col.id);
                }
            });
            activeCols = activeCols.filter(c => colsKeep.has(c.id));
        }

        // Sort: pinned columns first, then by density
        const colPriority = (col: Column): number => {
            if (col.id === 'recordId') return 0;
            if (col.id === 'url' || (col as any).type === 'link') return 1;
            if ((col as any).type === 'image_array') return 2;
            return 3;
        };
        activeCols.sort((a, b) => {
            const pa = colPriority(a), pb = colPriority(b);
            if (pa !== pb) return pa - pb;
            const countA = filteredRows.filter(r => {
                const val = r[a.id];
                return val !== undefined && val !== null && String(val).trim() !== '';
            }).length;
            const countB = filteredRows.filter(r => {
                const val = r[b.id];
                return val !== undefined && val !== null && String(val).trim() !== '';
            }).length;
            return countB - countA;
        });

        return activeCols;
    }, [baseColumns, filteredRows, hideRepeatingData, removeEmptyColumns, hideMostlyEmptyColumns, removeDuplicateColumns]);

    // Stage 4: Column defs (depends on activeColumns + renames + showImages)
    const processedColumnDefs = useMemo(() => {
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

                const strValue = String(value);

                const isImageUrl = (v: string) =>
                    /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico|tiff?)(\?[^"]*)?$/i.test(v) ||
                    /^data:image\//i.test(v);

                const looksLikeImage = col.type === 'image' || (strValue.length < 500 && isImageUrl(strValue));

                if (col.type === 'image_array') {
                    let urls: string[] = [];
                    if (Array.isArray(value)) {
                        urls = value as string[];
                    } else {
                        try { urls = JSON.parse(strValue); } catch { urls = [strValue]; }
                    }
                    if (!showImages) return <span className="text-xs text-text-muted truncate block w-full" title={urls.join(', ')}>{urls.length} images</span>;
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%', height: '100%', overflow: 'hidden' }}>
                            {urls.slice(0, 5).map((url, i) => (
                                <img
                                    key={i}
                                    src={url}
                                    alt={`img-${i}`}
                                    style={{ height: '24px', width: 'auto', maxWidth: '40px', objectFit: 'contain', borderRadius: '4px' }}
                                    loading="lazy"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                            ))}
                            {urls.length > 5 && <span className="text-xs text-text-muted">+{urls.length - 5}</span>}
                        </div>
                    );
                }

                if (looksLikeImage) {
                    if (!showImages) return <span className="text-xs text-text-muted truncate block w-full" title={strValue}>{strValue}</span>;
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', overflow: 'hidden' }}>
                            <img
                                src={strValue}
                                alt="cell"
                                style={{ height: '24px', width: 'auto', maxWidth: '100%', objectFit: 'contain', borderRadius: '4px' }}
                                loading="lazy"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                    (e.target as HTMLImageElement).insertAdjacentHTML('afterend',
                                        `<span style="font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${strValue}</span>`
                                    );
                                }}
                            />
                        </div>
                    );
                }

                if (col.type === 'markdown') {
                    const preview = strValue.replace(/[#*`>\-_~\[\]]/g, '').slice(0, 60).trim();
                    return (
                        <div className="flex items-center gap-1.5 w-full overflow-hidden">
                            <button
                                onClick={(e) => { e.stopPropagation(); setMdPreview({ content: strValue, title: renames[col.id] || col.name }); }}
                                className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] hover:bg-primary/20 transition-colors"
                            >
                                <FileText size={9} />
                                MD
                            </button>
                            <span className="text-xs text-text-muted truncate flex-1">{preview || '…'}</span>
                        </div>
                    );
                }

                if (col.type === 'url') {
                    return (
                        <a
                            href={strValue}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-ai hover:text-white underline decoration-dotted underline-offset-2 block w-full truncate text-xs"
                            title={strValue}
                        >
                            {strValue}
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
        return defs;
    }, [activeColumns, renames, showImages]);

    // Derive final outputs for external consumption
    const processedRowData = filteredRows;
    const availableColumns = activeColumns;

    useImperativeHandle(ref, () => ({
        getProcessedData: () => {
            // Export uses original compact rows (non-exploded), no tabledata columns
            const exportCols = columns.filter(c => !(c as any).hidden && (c as any).type !== 'tabledata');
            return {
                columns: exportCols.map(col => ({
                    id: col.id,
                    name: renames[col.id] || col.name,
                    type: col.type,
                })),
                rows: rows.map(r => {
                    const out: Record<string, any> = {};
                    exportCols.forEach(col => {
                        let val = r.data[col.id];
                        const t = (col as any).type;
                        if (typeof val === 'string' && (t === 'json' || t === 'image_array' || t === 'link_array' || t === 'text_array')) {
                            try { val = JSON.parse(val); } catch {}
                        }
                        out[col.id] = val;
                    });
                    return out;
                })
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
                        <FilterOption label={t('filters.richFirst')} active={prioritizeRichColumns} onClick={() => setPrioritizeRichColumns(!prioritizeRichColumns)} icon="📈" description={t('filters.richFirstDesc')} />
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
                    context={{ onRenameColumn, onDeleteColumn }}
                />
            </div>
            <style>{/* ... style omitted ... */}</style>
            {/* Markdown Preview Modal */}
            {mdPreview && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                    onClick={() => setMdPreview(null)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setMdPreview(null); }}
                >
                    <div
                        className="relative bg-[#0f172a] border border-white/10 rounded-xl shadow-2xl w-full max-w-2xl max-h-[78vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0 bg-white/[0.03] rounded-t-xl">
                            <div className="flex items-center gap-2">
                                <FileText size={13} className="text-primary shrink-0" />
                                <span className="text-sm font-semibold text-text-primary truncate">{mdPreview.title}</span>
                            </div>
                            <button
                                onClick={() => setMdPreview(null)}
                                className="p-2 rounded-md text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors"
                                aria-label={t('preview.close')}
                            >
                                <X size={15} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="overflow-y-auto px-6 py-5 text-sm text-[#cbd5e1] leading-relaxed space-y-3">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    h1: ({ children }) => <h1 className="text-xl font-bold text-white mt-5 mb-2 border-b border-white/10 pb-1">{children}</h1>,
                                    h2: ({ children }) => <h2 className="text-base font-semibold text-white mt-4 mb-1.5">{children}</h2>,
                                    h3: ({ children }) => <h3 className="text-sm font-semibold text-slate-200 mt-3 mb-1">{children}</h3>,
                                    h4: ({ children }) => <h4 className="text-sm font-medium text-slate-300 mt-2 mb-0.5">{children}</h4>,
                                    p: ({ children }) => <p className="text-slate-300 leading-relaxed mb-3">{children}</p>,
                                    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 decoration-cyan-400/40 transition-colors">{children}</a>,
                                    strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
                                    em: ({ children }) => <em className="italic text-slate-300">{children}</em>,
                                    code: ({ children, className }) => {
                                        const isBlock = className?.includes('language-');
                                        return isBlock
                                            ? <code className="block bg-slate-800/80 border border-white/10 rounded-md px-4 py-3 text-[12px] font-mono text-emerald-300 overflow-x-auto whitespace-pre my-2">{children}</code>
                                            : <code className="bg-slate-800 rounded px-1.5 py-0.5 text-[11px] font-mono text-emerald-300 border border-white/10">{children}</code>;
                                    },
                                    pre: ({ children }) => <pre className="my-2">{children}</pre>,
                                    blockquote: ({ children }) => <blockquote className="border-l-2 border-primary pl-4 my-3 text-slate-400 italic">{children}</blockquote>,
                                    ul: ({ children }) => <ul className="list-disc list-outside pl-5 space-y-0.5 mb-3 text-slate-300">{children}</ul>,
                                    ol: ({ children }) => <ol className="list-decimal list-outside pl-5 space-y-0.5 mb-3 text-slate-300">{children}</ol>,
                                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                                    hr: () => <hr className="border-white/10 my-4" />,
                                    table: ({ children }) => <div className="overflow-x-auto my-3"><table className="w-full text-xs border-collapse border border-white/10">{children}</table></div>,
                                    thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
                                    th: ({ children }) => <th className="border border-white/10 px-3 py-1.5 text-left font-semibold text-slate-200">{children}</th>,
                                    td: ({ children }) => <td className="border border-white/10 px-3 py-1.5 text-slate-300">{children}</td>,
                                    img: ({ src, alt }) => <img src={src} alt={alt} className="max-w-full rounded-lg my-2 border border-white/10" loading="lazy" />,
                                }}
                            >
                                {mdPreview.content}
                            </ReactMarkdown>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .ag-theme-alpine {
                    --ag-background-color: #020617;
                    --ag-foreground-color: #E5E7EB;
                    --ag-header-background-color: #0d1321;
                    --ag-header-foreground-color: #CBD5E1;
                    --ag-border-color: rgba(148, 163, 184, 0.18);
                    --ag-row-hover-color: rgba(255, 255, 255, 0.06);
                    --ag-row-border-color: rgba(148, 163, 184, 0.10);
                    --ag-odd-row-background-color: #020617;
                    --ag-even-row-background-color: rgba(255, 255, 255, 0.025);
                    --ag-input-focus-border-color: #22D3EE;
                    --ag-font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    --ag-font-size: 13px;
                    --ag-header-height: 44px;
                    --ag-row-height: 40px;
                    --ag-selected-row-background-color: rgba(244, 208, 63, 0.10);
                    --ag-cell-horizontal-padding: 12px;

                    --custom-grid-border: 1px solid rgba(148, 163, 184, 0.18);
                }

                /* Grid Container */
                .ag-root-wrapper {
                    border: var(--custom-grid-border);
                    border-radius: 8px;
                    background-color: var(--ag-background-color);
                }

                /* Header Styling */
                .ag-header {
                    border-bottom: 1px solid rgba(148, 163, 184, 0.18);
                    font-size: 12.5px;
                    font-weight: 600;
                    letter-spacing: 0.01em;
                    text-transform: none;
                }

                .ag-header-cell:hover {
                    background-color: rgba(255, 255, 255, 0.04);
                }

                .ag-header-icon {
                    color: #64748B;
                }

                /* Row Styling */
                .ag-row {
                    border-bottom-color: var(--ag-row-border-color);
                    transition: background-color 0.1s ease;
                }

                .ag-row-selected {
                    border-left: 2px solid #F4D03F !important;
                }

                /* Cell Styling */
                .ag-cell {
                    line-height: 1.5;
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
                    border-top: 1px solid rgba(148, 163, 184, 0.18);
                    font-size: 12.5px;
                    color: #94A3B8;
                    padding: 8px 16px;
                }
            `}</style>
        </div>
    );
});

export default DataTable;

function FilterOption({ label, active, onClick, icon, description }: { label: string; active: boolean; onClick: () => void; icon: string; description?: string }) {
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
        }
    };

    const button = (
        <button
            onClick={onClick}
            onKeyDown={handleKeyDown}
            role="switch"
            aria-checked={active}
            aria-label={`${label}: ${active ? 'enabled' : 'disabled'}${description ? `. ${description}` : ''}`}
            className={`
                flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-semibold transition-all duration-300 select-none group relative overflow-hidden
                focus-visible:ring-2 focus-visible:ring-accent-ai/50 focus-visible:outline-none
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
                        <Check size={12} />
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

    return description ? <Tooltip title={description} placement="top"><span>{button}</span></Tooltip> : button;
}
