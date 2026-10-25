import { useState, useEffect, useRef, useCallback } from 'react';
import { on, RunComplete, RunProgress } from '../../shared/messages';
import { useTranslation } from 'react-i18next';
import { useTableData, useAllTableData, useExportData } from '../hooks/useDatabase';
import { db } from '@/shared/db';
import type { TypedColumnDef } from '@/shared/types/database';
import DataTable from '../components/ui/DataTable';
import SchemaMapDialog, { OutputMappingState } from '../components/ui/SchemaMapDialog';
import { Calendar, ChevronDown, Database, Download, ExternalLink, FileArchive, FileJson, FileText, Sheet, Table2, Webhook, Zap } from 'lucide-react';
import { DEFAULT_CHUNK_CHARS, markdownFiles, markdownJsonl, pagesFromRows } from '../../shared/export/markdownExport';
import { ZipWriter } from '../services/images/zip';
import { downloadBlob, downloadText } from '../services/download';
import { xlsxBytes } from '../../shared/export/xlsx';
import { slug } from '../../shared/utils/text';
import { sendTable, stopSync, syncTable } from '@/shared/integrations/sheetsSync';
import { storage } from '@/shared/storage';
import { Button, Chip, EmptyState, Menu, MenuDivider, MenuItem, Notice, Select, Spinner, Text } from '../ui';

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
    const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null);
    const [sheetBusy, setSheetBusy] = useState(false);
    const [sheetError, setSheetError] = useState<string | null>(null);

    /** Google Sheets: the dataset to the user's spreadsheet (its own tab), its new rows following. */
    const sheetAction = async (action: () => Promise<unknown>) => {
        if (!selectedId) return;
        setSheetError(null);
        if (!(await storage.get('integrations'))?.sheets) {
            setSheetError('Connect your Google Sheet first: Settings → Integrations → Google Sheets.');
            return;
        }
        setSheetBusy(true);
        try { await action(); } catch (e) { setSheetError((e as Error).message); } finally { setSheetBusy(false); refreshTable(); }
    };

    // Real-time refresh: listen for extraction progress and completion messages.
    // When the currently-viewed table is a live preview, reload its rows as new
    // data is appended. Also refresh the table list when a new extraction completes.
    useEffect(() => {
        const onProgress = ({ previewTableId }: RunProgress) => {
            if (previewTableId != null && previewTableId === selectedId) refreshTable();
        };
        const onComplete = ({ tableId }: RunComplete) => {
            refreshAll();
            if (tableId != null && tableId === selectedId) refreshTable();
        };
        const offs = [
            on('BULK_EXTRACTION_PROGRESS', onProgress),
            on('METADATA_EXTRACTION_PROGRESS', onProgress),
            on('BULK_EXTRACTION_COMPLETE', onComplete),
            on('METADATA_EXTRACTION_COMPLETE', onComplete),
        ];
        return () => offs.forEach(off => off());
    }, [selectedId, refreshTable, refreshAll]);

    const handleColumnRenamed = useCallback(async (colId: string, newName: string) => {
        if (!selectedId || !tableData) return;
        await db.tables.renameColumn(selectedId, colId, newName);
    }, [selectedId, tableData]);

    const handleColumnDeleted = useCallback(async (colId: string) => {
        if (!selectedId || !tableData) return;
        await db.tables.removeColumn(selectedId, colId);
        refreshTable();
    }, [selectedId, tableData, refreshTable]);

    const handleColumnsMerged = useCallback(async (merge: { id: string; name: string; sources: string[]; separator: string }) => {
        if (!selectedId) return;
        // The merges as saved now (the loaded table may predate this view's earlier merges).
        const current = await db.tables.get(selectedId);
        await db.tables.update(selectedId, { view: { merges: [...(current?.view.merges ?? []), merge] } });
    }, [selectedId]);

    const handleTypedColumnsChanged = useCallback(async (defs: TypedColumnDef[]) => {
        if (!selectedId) return;
        await db.tables.update(selectedId, { view: { typed: defs } });
    }, [selectedId]);

    /**
     * The table as exported, with **every** row: the table on screen loads the first rows only
     * (`ROW_PAGE_LIMIT`), and an export of those alone would cut a large run short without a word.
     */
    const processed = async () => {
        if (!tableRef.current) throw new Error('The table is still loading.');
        // From the database: the rows on screen may be the first ones only, and predate edits.
        const all = selectedId ? await db.tables.rowsPage(selectedId, 0, Math.max(totalRows, rows.length, 1)) : rows;
        return tableRef.current.getProcessedData(all);
    };

    const handleCellEdited = useCallback(async (rowId: number, colId: string, value: unknown) => {
        const row = await db.tables.updateRow(rowId, { [colId]: value });
        return Object.keys(row.edits ?? {});
    }, []);

    const handleExportCSV = async () => {
        if (!tableRef.current) return;
        try {
            const { columns, rows } = await processed();
            exportToCSV(columns, rows, tableData?.name || 'export');
        } catch (err: any) {
            alert(`Export failed: ${err.message}`);
        }
    };

    /** Excel, typed: numbers, dates and links as Excel's own (`shared/export/xlsx.ts`). */
    const handleExportXlsx = async () => {
        try {
            const { columns, rows } = await processed();
            const bytes = xlsxBytes(columns, rows, tableData?.name || 'Data');
            downloadBlob(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${exportName}.xlsx`);
        } catch (err: any) {
            alert(`Export failed: ${err.message}`);
        }
    };

    const handleExportJSON = async () => {
        if (!tableRef.current) return;
        try {
            const { columns, rows } = await processed();
            exportToJSON(columns, rows, tableData?.name || 'export');
        } catch (err: any) {
            alert(`Export failed: ${err.message}`);
        }
    };

    const [schemaMap, setSchemaMap] = useState<{ columns: { id: string; name: string; type?: string }[]; rows: any[] } | null>(null);

    const openSchemaMap = async () => {
        if (!tableRef.current) return;
        setSchemaMap(await processed());
    };

    const handleOutputMapping = useCallback(async (state: OutputMappingState) => {
        if (!selectedId) return;
        await db.tables.update(selectedId, { view: { mapping: state } });
    }, [selectedId]);

    const handleExportMarkdown = async () => {
        if (!tableRef.current) return;
        try {
            const { columns, rows } = await processed();
            exportToMarkdown(columns, rows, tableData?.name || 'export');
        } catch (err: any) {
            alert(`Export failed: ${err.message}`);
        }
    };

    const hasMarkdownColumns = tableData?.columns.some(c => c.type === 'markdown') ?? false;

    /** The dataset's pages (a markdown column per row) as a zip of `.md` files or as `.jsonl`. */
    const markdownPages = async () => {
        if (!tableRef.current || !tableData) return [];
        const { columns, rows } = await processed();
        return pagesFromRows(columns, rows, new Date(tableData.createdAt).toISOString());
    };
    const exportName = slug(tableData?.name || 'export', '-', 'export');
    const handleExportMarkdownZip = async () => {
        const zip = new ZipWriter();
        const encoder = new TextEncoder();
        for (const file of markdownFiles(await markdownPages())) zip.add(file.path, encoder.encode(file.text));
        downloadBlob(await zip.finish(), `${exportName}.zip`);
    };
    const handleExportJsonl = async (chunkChars?: number) => {
        downloadText(markdownJsonl(await markdownPages(), chunkChars), `${exportName}${chunkChars ? '-chunks' : ''}.jsonl`, 'application/jsonl');
    };

    const handleIntegrationExport = async (type: 'webhook' | 'zapier' | 'airtable') => {
        if (!tableRef.current) return;

        try {
            const { columns, rows } = await processed();
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

    // Read tableId from URL if present
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('tableId');
        if (id) {
            setSelectedId(Number(id));
        }
    }, []);

    if (loadingAll) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg text-ink-2">
                <Spinner size={28} />
                <Text size="small" tone="muted">{t('page.loadingDatasets')}</Text>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="flex h-full items-center justify-center bg-bg p-8">
                <Notice tone="danger" title={t('page.errorTitle')} className="max-w-md">{loadError}</Notice>
            </div>
        );
    }

    if (tableDatas.length === 0) {
        return (
            <div className="flex h-full items-center justify-center bg-bg p-8">
                <EmptyState icon={<Database />} title={t('page.noExtractionsTitle')}>{t('page.noExtractionsDesc')}</EmptyState>
            </div>
        );
    }

    const exportItem = (action: () => unknown) => () => { void action(); setExportMenu(null); };

    return (
        <div className="flex h-full w-full flex-col bg-bg text-ink">
            <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3">
                <span className="flex size-9 shrink-0 -rotate-6 items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-brand text-on-brand">
                    <Table2 size={17} />
                </span>
                <Select className="max-w-xl min-w-[220px] flex-1" aria-label={t('page.selectDataset')} value={selectedId ?? 0}
                    onChange={v => setSelectedId(v || null)}
                    options={[
                        { value: 0, label: t('page.selectPlaceholder') },
                        ...tableDatas.map(td => ({ value: td.id!, label: `${td.name} — ${new Date(td.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` })),
                    ]} />

                {tableData && (
                    <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
                        <span className="hidden items-center gap-1.5 text-caption text-ink-3 lg:flex"><Calendar size={13} />{new Date(tableData.createdAt).toLocaleDateString()}</span>
                        <Chip size="md" tone="brand">
                            {hasMore ? `${rows.length.toLocaleString()} / ${totalRows.toLocaleString()} ${t('page.rows')}` : `${rows.length} ${t('page.rows')}`}
                        </Chip>
                        <Chip size="md">{tableData.columns.length} {t('page.columns')}</Chip>
                        {tableData.sourceUrl && (
                            <a href={tableData.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`${t('page.source')}: ${tableData.sourceUrl}`}
                                className="inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-small font-semibold text-ink-2 no-underline hover:bg-ink/6 hover:text-ink">
                                {t('page.source')} <ExternalLink size={13} />
                            </a>
                        )}
                        <Button size="sm" variant="primary" icon={<Download />} iconEnd={<ChevronDown />} aria-haspopup="menu" aria-expanded={!!exportMenu}
                            onClick={e => setExportMenu(exportMenu ? null : e.currentTarget)}>
                            {t('page.export')}
                        </Button>
                        <Menu anchor={exportMenu} onClose={() => setExportMenu(null)} align="end">
                            <div className="px-2.5 pt-1.5 pb-1 text-caption font-semibold text-ink-3">{t('page.localExport')}</div>
                            <MenuItem icon={<Sheet />} onClick={exportItem(handleExportXlsx)}>{t('page.exportXlsx')}</MenuItem>
                            <MenuItem icon={<FileText />} onClick={exportItem(handleExportCSV)}>{t('page.exportCSV')}</MenuItem>
                            <MenuItem icon={<FileJson />} onClick={exportItem(handleExportJSON)}>{t('page.exportJSON')}</MenuItem>
                            <MenuItem icon={<FileJson />} onClick={exportItem(openSchemaMap)}>JSON to a schema…</MenuItem>
                            {hasMarkdownColumns && <>
                                <MenuItem icon={<FileText />} onClick={exportItem(handleExportMarkdown)}>{t('page.exportMarkdown')}</MenuItem>
                                <MenuItem icon={<FileArchive />} onClick={exportItem(() => void handleExportMarkdownZip())}>{t('page.exportMarkdownZip')}</MenuItem>
                                <MenuItem icon={<FileJson />} onClick={exportItem(() => handleExportJsonl())}>{t('page.exportJsonl')}</MenuItem>
                                <MenuItem icon={<FileJson />} onClick={exportItem(() => handleExportJsonl(DEFAULT_CHUNK_CHARS))}>{t('page.exportJsonlChunks')}</MenuItem>
                            </>}
                            <MenuDivider />
                            <div className="px-2.5 pt-1 pb-1 text-caption font-semibold text-ink-3">{t('page.integrations')}</div>
                            <MenuItem icon={<Sheet />} onClick={exportItem(() => void sheetAction(() => sendTable(selectedId!)))}>
                                {tableData.view.sheet?.sync ? 'Synced to Google Sheets' : 'Send to Google Sheets'}
                            </MenuItem>
                            <MenuItem icon={<Webhook />} onClick={exportItem(() => handleIntegrationExport('webhook'))}>{t('page.exportWebhook')}</MenuItem>
                            <MenuItem icon={<Database />} onClick={exportItem(() => handleIntegrationExport('airtable'))}>{t('page.exportAirtable')}</MenuItem>
                            <MenuItem icon={<Zap />} onClick={exportItem(() => handleIntegrationExport('zapier'))}>{t('page.exportZapier')}</MenuItem>
                        </Menu>
                    </div>
                )}
            </header>

            {tableData && (tableData.view.sheet || sheetError || sheetBusy) && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface-2/50 px-5 py-2" data-testid="sheet-bar">
                    <Sheet size={15} className="text-success" />
                    {sheetBusy ? <Text size="small" className="flex items-center gap-2"><Spinner size={12} /> Sending to Google Sheets…</Text> : tableData.view.sheet && (
                        <Text size="small">
                            {tableData.view.sheet.synced.toLocaleString()} rows in Google Sheets, tab “{tableData.view.sheet.tab}”
                            {tableData.view.sheet.sync ? ' · new rows are added as they come' : ' · not syncing'}
                        </Text>
                    )}
                    <span className="ml-auto flex gap-1">
                        {tableData.view.sheet?.url && <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => chrome.tabs.create({ url: tableData.view.sheet!.url! })}>Open</Button>}
                        {tableData.view.sheet?.sync && <Button size="sm" variant="ghost" onClick={() => void sheetAction(() => stopSync(selectedId!))}>Stop syncing</Button>}
                        {tableData.view.sheet && !tableData.view.sheet.sync && <Button size="sm" variant="ghost" onClick={() => void sheetAction(() => sendTable(selectedId!))}>Sync again</Button>}
                    </span>
                    {(sheetError || tableData.view.sheet?.error) && (
                        <Notice tone="warning" className="w-full">
                            <span className="flex flex-wrap items-center justify-between gap-2">
                                <span>{sheetError || tableData.view.sheet?.error}</span>
                                {tableData.view.sheet?.sync && <Button size="sm" onClick={() => void sheetAction(() => syncTable(selectedId!))}>Try again</Button>}
                            </span>
                        </Notice>
                    )}
                </div>
            )}

            <div className="flex-1 overflow-hidden p-4">
                {loading ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-2">
                        <Spinner size={24} />
                        <Text size="small" tone="muted">{t('page.loadingTable')}</Text>
                    </div>
                ) : error ? (
                    <div className="flex h-full items-center justify-center p-8">
                        <Notice tone="danger" className="max-w-md">{error}</Notice>
                    </div>
                ) : tableData && rows.length > 0 ? (
                    <div className="h-full w-full">
                        <DataTable
                            key={tableData.id}
                            ref={tableRef}
                            columns={tableData.columns}
                            rows={rows}
                            defaultHideMostlyEmptyColumns={false}
                            initialMergedCols={tableData.view.merges}
                            initialTypedCols={tableData.view.typed}
                            onTypedColumnsChanged={handleTypedColumnsChanged}
                            onColumnRenamed={handleColumnRenamed}
                            onColumnDeleted={handleColumnDeleted}
                            onColumnsMerged={handleColumnsMerged}
                            onCellEdited={handleCellEdited}
                        />
                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center">
                        <EmptyState icon={<Table2 />} title={t('page.selectDataset')}>{t('page.selectDatasetDesc')}</EmptyState>
                    </div>
                )}
            </div>
            {schemaMap && (
                <SchemaMapDialog
                    open
                    onClose={() => setSchemaMap(null)}
                    columns={schemaMap.columns}
                    rows={schemaMap.rows}
                    tableName={tableData?.name || 'export'}
                    saved={tableData?.view.mapping}
                    onSave={handleOutputMapping}
                />
            )}
        </div>
    );
}
