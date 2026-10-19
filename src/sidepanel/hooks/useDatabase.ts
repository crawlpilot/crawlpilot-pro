import { useState, useEffect } from 'react';
import { downloadText } from '../services/download';
import { csvText } from '@/shared/utils/csv';
import { db } from '@/shared/db';
import { Table, Row } from '@/shared/types/database';
import type { JobWithRecipe } from '@/shared/db';
import { storage } from '@/shared/storage';

const ROW_PAGE_LIMIT = 2000;

/**
 * Hook for managing table data.
 *
 * Loads the first ROW_PAGE_LIMIT rows to keep memory bounded on low-end devices.
 * When the table has more rows than that, `hasMore` is true and `totalRows` reflects
 * the actual count so callers can display an informational notice.
 */
export function useTableData(tableId?: number | null) {
    const [tableData, setTableData] = useState<Table | null>(null);
    const [rows, setRows] = useState<Row[]>([]);
    const [totalRows, setTotalRows] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = async (id: number) => {
        try {
            setLoading(true);
            setError(null);

            const [data, count, pageRows] = await Promise.all([
                db.tables.get(id),
                db.tables.rowCount(id),
                db.tables.rowsPage(id, 0, ROW_PAGE_LIMIT),
            ]);

            // Columns are final when saved (one per field), so rows load as they are.
            const tableRows = pageRows;

            setTableData(data);
            setRows(tableRows);
            setTotalRows(count);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!tableId) {
            setLoading(false);
            return;
        }
        load(tableId);
    }, [tableId]);

    const refresh = () => {
        if (tableId) load(tableId);
    };

    const hasMore = totalRows > rows.length;

    return { tableData, rows, totalRows, hasMore, loading, error, refresh };
}

/**
 * Hook for managing all table data entries
 */
export function useAllTableData() {
    const [tableDatas, setTableDatas] = useState<Table[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = async () => {
        try {
            console.log('🔄 [useAllTableData] Refreshing table data...');
            setLoading(true);
            setError(null);
            const data = await db.tables.list();
            console.log(`✅ [useAllTableData] Received ${data.length} items from DB.`);
            setTableDatas(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load data');
            console.error('Error loading all table data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    return { tableDatas, loading, error, refresh };
}

/**
 * Hook for Data Export
 */
export function useExportData() {
    const downloadFile = (content: string, fileName: string, contentType: string) => downloadText(content, fileName, contentType, true);

    const exportToCSV = (columns: { id: string, name: string }[], data: any[], fileName: string) => {
        try {
            downloadFile(csvText(columns, data), `${fileName}.csv`, 'text/csv;charset=utf-8;');
        } catch (err) {
            console.error('Export CSV failed:', err);
            throw err;
        }
    };

    const exportToJSON = (columns: { id: string, name: string }[], data: any[], fileName: string) => {
        try {
            const jsonData = data.map(row => {
                const obj: Record<string, any> = {};
                columns.forEach(col => {
                    obj[col.name] = row[col.id];
                });
                return obj;
            });
            const jsonString = JSON.stringify(jsonData, null, 2);
            downloadFile(jsonString, `${fileName}.json`, 'application/json');
        } catch (err) {
            console.error('Export JSON failed:', err);
            throw err;
        }
    };

    const exportToWebhook = async (columns: { id: string, name: string }[], data: any[], type: 'webhook' | 'zapier' = 'webhook') => {
        try {
            const integrations = await storage.get('integrations');
            const url = type === 'webhook' ? integrations?.webhookUrl : integrations?.zapierUrl;

            if (!url) {
                throw new Error(`No ${type === 'webhook' ? 'Webhook' : 'Zapier'} URL configured. Please go to Settings.`);
            }

            const payload = data.map(row => {
                const obj: Record<string, any> = {};
                columns.forEach(col => {
                    obj[col.name] = row[col.id];
                });
                return obj;
            });

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: 'Crawl Pilot',
                    timestamp: new Date().toISOString(),
                    type: type,
                    data: payload
                })
            });

            if (!response.ok) {
                throw new Error(`Export failed with status: ${response.status}`);
            }

            return true;
        } catch (err) {
            console.error(`${type} export failed:`, err);
            throw err;
        }
    };

    const exportToAirtable = async (columns: { id: string, name: string }[], data: any[]) => {
        try {
            const integrations = await storage.get('integrations');
            const { airtableApiKey, airtableBaseId, airtableTableName } = integrations || {};

            if (!airtableApiKey || !airtableBaseId || !airtableTableName) {
                throw new Error('Airtable configuration missing. Please go to Settings.');
            }

            const records = data.map(row => {
                const fields: Record<string, any> = {};
                columns.forEach(col => {
                    fields[col.name] = row[col.id];
                });
                return { fields };
            });

            const url = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(airtableTableName)}`;

            for (let i = 0; i < records.length; i += 10) {
                const chunk = records.slice(i, i + 10);
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${airtableApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ records: chunk })
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(`Airtable error: ${error?.error?.message || response.statusText}`);
                }
            }
            return true;
        } catch (err) {
            console.error('Airtable export failed:', err);
            throw err;
        }
    };

    const exportToMarkdown = (columns: { id: string, name: string, type?: string }[], data: any[], fileName: string) => {
        try {
            const urlCol = columns.find(c => c.id === 'source_url' || c.type === 'url');
            const mdCols = columns.filter(c => c.type === 'markdown');
            if (mdCols.length === 0) return;

            const sections = data.map(row => {
                const url = urlCol ? (row[urlCol.id] || '') : '';
                const header = url ? `# ${url}\n` : '';
                return mdCols.map(col => {
                    const content = (row[col.id] || '').trim();
                    if (!content) return '';
                    const label = mdCols.length > 1 ? `## ${col.name}\n\n` : '';
                    return `${header}${label}${content}`;
                }).filter(Boolean).join('\n\n');
            }).filter(Boolean);

            const md = sections.join('\n\n---\n\n');
            downloadFile(md, `${fileName}.md`, 'text/markdown;charset=utf-8;');
        } catch (err) {
            console.error('Export Markdown failed:', err);
            throw err;
        }
    };

    return { exportToCSV, exportToJSON, exportToWebhook, exportToAirtable, exportToMarkdown };
}

/**
 * Hook for managing job history
 */
export function useJobHistory() {
    const [jobs, setJobs] = useState<JobWithRecipe[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await db.jobs.list();
            setJobs(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load jobs');
            console.error('Error loading jobs:', err);
        } finally {
            setLoading(false);
        }
    };

    const deleteJob = async (id: number) => {
        try {
            const job = jobs.find(j => j.id === id);
            if (job) await db.jobs.remove(job);
            setJobs(prev => prev.filter(j => j.id !== id));
        } catch (err) {
            console.error('Failed to delete job:', err);
            throw err;
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    return { jobs, loading, error, refresh, deleteJob };
}
