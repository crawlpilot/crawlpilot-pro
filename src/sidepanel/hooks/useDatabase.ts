import { useState, useEffect } from 'react';
import { db } from '@/shared/db/db-manager';
import { NEW_TABLE_NAMES, TableData, TableRow, Job, AutomationRecipe } from '@/shared/types/database';
import { TableUnifier } from '@/shared/utils/TableUnifier';

/**
 * Hook for managing table data
 */
export function useTableData(tableDataId?: number | null) {
    const [tableData, setTableData] = useState<TableData | null>(null);
    const [rows, setRows] = useState<TableRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!tableDataId) {
            setLoading(false);
            return;
        }

        (async () => {
            try {
                console.log(`📥 [useTableData] Fetching data for ID: ${tableDataId}...`);
                setLoading(true);
                setError(null);

                let data = await db.getTableData(tableDataId);
                let tableRows = await db.getTableRows(tableDataId);

                if (data && data.columns && tableRows) {
                    const unified = TableUnifier.unifyTableData(data.columns, tableRows);
                    data.columns = unified.columns;
                    tableRows = unified.rows;
                }

                console.log(`✅ [useTableData] Loaded. Rows: ${tableRows.length}, Columns: ${data?.columns?.length}`);

                if (tableRows.length > 0) {
                    console.log('📦 [useTableData] First Row Data Sample:', JSON.stringify(tableRows[0].data, null, 2));
                    console.log('📦 [useTableData] First Row ID:', tableRows[0].id);
                }
                if (data?.columns && data.columns.length > 0) {
                    console.log('📦 [useTableData] First Column Def:', JSON.stringify(data.columns[0], null, 2));
                }

                setTableData(data);
                setRows(tableRows);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load data');
                console.error('Error loading table data:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, [tableDataId]);

    return { tableData, rows, loading, error };
}

/**
 * Hook for managing all table data entries
 */
export function useAllTableData() {
    const [tableDatas, setTableDatas] = useState<TableData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = async () => {
        try {
            console.log('🔄 [useAllTableData] Refreshing table data...');
            setLoading(true);
            setError(null);
            const data = await db.getAllTableData();
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
    /**
     * Helper for standard local file downloads
     */
    const downloadFile = (content: string, fileName: string, contentType: string) => {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const nameParts = fileName.split('.');
        let finalFileName = fileName;
        if (nameParts.length > 1) {
            const ext = nameParts.pop();
            finalFileName = `${nameParts.join('.')}_${timestamp}.${ext}`;
        } else {
            finalFileName = `${fileName}_${timestamp}`;
        }

        link.setAttribute('href', url);
        link.setAttribute('download', finalFileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const exportToCSV = (columns: { id: string, name: string }[], data: any[], fileName: string) => {
        try {
            const headers = columns.map((col) => col.name).join(',');
            const csvRows = data.map((row) => {
                return columns
                    .map((col) => {
                        const value = row[col.id];
                        if (typeof value === 'string') {
                            const escaped = value.replace(/"/g, '""');
                            if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
                                return `"${escaped}"`;
                            }
                            return value;
                        }
                        return value ?? '';
                    })
                    .join(',');
            });
            const csv = [headers, ...csvRows].join('\n');
            downloadFile(csv, `${fileName}.csv`, 'text/csv;charset=utf-8;');
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
            const { integrations } = await chrome.storage.local.get(['integrations']) as { integrations?: any };
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
            const { integrations } = await chrome.storage.local.get(['integrations']) as { integrations?: any };
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

    const exportToGoogleSheets = async (_columns: { id: string, name: string }[], _data: any[]) => {
        alert("Google Sheets Authentication is coming soon. Please use Webhooks/Zapier for automated exports.");
        return false;
    };

    return { exportToCSV, exportToJSON, exportToWebhook, exportToAirtable, exportToGoogleSheets };
}

/**
 * Hook for managing job history
 */
export function useJobHistory() {
    const [jobs, setJobs] = useState<(Job & { recipe?: AutomationRecipe })[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await db.getAllJobs();
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
            if (job?.result?.tableDataId) {
                await db.deleteTableData(job.result.tableDataId);
            }
            await new Promise<void>((resolve, reject) => {
                const transaction = (db as any).db.transaction([NEW_TABLE_NAMES.JOBS], 'readwrite');
                const store = transaction.objectStore(NEW_TABLE_NAMES.JOBS);
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
            if (job?.recipeId) {
                try {
                    const rTrans = (db as any).db.transaction([NEW_TABLE_NAMES.RECIPES], 'readwrite');
                    rTrans.objectStore(NEW_TABLE_NAMES.RECIPES).delete(job.recipeId);
                } catch (e) { console.warn("Failed to delete recipe", e); }
            }
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
