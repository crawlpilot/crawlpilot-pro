import { useState, useEffect } from 'react';
import { db } from '@/shared/db/db-manager';
import { NEW_TABLE_NAMES, TableData, TableRow, Job, AutomationRecipe } from '@/shared/types/database';

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

                const data = await db.getTableData(tableDataId);
                const tableRows = await db.getTableRows(tableDataId);

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
/**
 * Hook for Data Export
 */
export function useExportData() {
    const exportToCSV = (columns: { id: string, name: string }[], data: any[], fileName: string) => {
        try {
            // Create CSV header
            const headers = columns.map((col) => col.name).join(',');

            // Create CSV rows
            const csvRows = data.map((row) => {
                return columns
                    .map((col) => {
                        const value = row[col.id];
                        // Handle values with commas, quotes, or newlines
                        if (typeof value === 'string') {
                            // Escape quotes by doubling them
                            const escaped = value.replace(/"/g, '""');
                            // Wrap in quotes if it contains comma, quote, or newline
                            if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
                                return `"${escaped}"`;
                            }
                            return value;
                        }
                        return value ?? '';
                    })
                    .join(',');
            });

            // Combine
            const csv = [headers, ...csvRows].join('\n');

            // Download
            downloadFile(csv, `${fileName}.csv`, 'text/csv;charset=utf-8;');
        } catch (err) {
            console.error('Export CSV failed:', err);
            throw err;
        }
    };

    const exportToJSON = (columns: { id: string, name: string }[], data: any[], fileName: string) => {
        try {
            // Construct array of objects with proper column names
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

    const downloadFile = (content: string, fileName: string, contentType: string) => {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        // If filename already has extension, insert timestamp before it, else append
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

    return { exportToCSV, exportToJSON };
}

/**
 * Hook for managing job history (Refactored from Automations)
 */
export function useJobHistory() {
    // We return jobs, but hydrating them to look like "Execution History"
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

            // Delete TableData if linked
            if (job?.result?.tableDataId) {
                await db.deleteTableData(job.result.tableDataId);
            }

            // Delete Job record
            await new Promise<void>((resolve, reject) => {
                const transaction = (db as any).db.transaction([NEW_TABLE_NAMES.JOBS], 'readwrite');
                const store = transaction.objectStore(NEW_TABLE_NAMES.JOBS);
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            // Optional: Delete Recipe if no other jobs use it? 
            // For now, leave recipe or delete it if we treat them as 1:1 in this phase.
            if (job?.recipeId) {
                // Check if other jobs exist for this recipe? Too expensive.
                // Just delete it to keep it clean for now (Migration assumes 1:1 for legacy)
                // Start a new transaction for recipe deletion
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
