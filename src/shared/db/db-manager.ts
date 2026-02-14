import { TABLE_NAMES, NEW_TABLE_NAMES, TableData, TableRow, ExtractionResult, Column, AutomationRecipe, Job } from '../types/database';

/**
 * IndexedDB Manager for Chrome Extension data storage
 */
export class DBManager {
    private dbName = 'crawl-pilot';
    private version = 5; // Upgraded to V5 to fix sourceUrl in migration
    private db: IDBDatabase | null = null;
    // Cache for table data to avoid frequent reads
    // private _currentTableDataId: number | null = null;

    /**
     * Initialize the database connection
     */
    async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                console.log('✅ IndexedDB initialized:', this.dbName);
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                console.log(`Creating/Updating DB to version ${this.version}`);

                // --- EXISTING STORES (Legacy Support) ---

                // [CLEANUP] Remove legacy 'automations' store if it exists
                if (db.objectStoreNames.contains('automations')) {
                    db.deleteObjectStore('automations');
                }

                // TABLE DATA store
                if (!db.objectStoreNames.contains(TABLE_NAMES.TABLE_DATA)) {
                    const store = db.createObjectStore(TABLE_NAMES.TABLE_DATA, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                    store.createIndex('automationId', 'automationId', { unique: false });
                }

                // TABLE ROWS store
                if (!db.objectStoreNames.contains(TABLE_NAMES.TABLE_ROWS)) {
                    const store = db.createObjectStore(TABLE_NAMES.TABLE_ROWS, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('tableDataId', 'tableDataId', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                    store.createIndex('tableData_dataHash', ['tableDataId', 'dataHash'], { unique: true });
                }

                // --- NEW STORES (V5) ---

                // If upgrading from V4 (partial migration), clear stores to re-migrate correctly
                if (event.oldVersion >= 4 && event.oldVersion < 5) {
                    if (db.objectStoreNames.contains(NEW_TABLE_NAMES.RECIPES)) db.deleteObjectStore(NEW_TABLE_NAMES.RECIPES);
                    if (db.objectStoreNames.contains(NEW_TABLE_NAMES.JOBS)) db.deleteObjectStore(NEW_TABLE_NAMES.JOBS);
                }

                // RECIPES Store
                if (!db.objectStoreNames.contains(NEW_TABLE_NAMES.RECIPES)) {
                    const store = db.createObjectStore(NEW_TABLE_NAMES.RECIPES, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('type', 'type', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }

                // JOBS Store
                if (!db.objectStoreNames.contains(NEW_TABLE_NAMES.JOBS)) {
                    const store = db.createObjectStore(NEW_TABLE_NAMES.JOBS, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('recipeId', 'recipeId', { unique: false });
                    store.createIndex('status', 'status', { unique: false });
                    store.createIndex('sourceUrl', 'sourceUrl', { unique: false }); // Index for sourceUrl
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }


            };
        });
    }

    /**
     * Ensure database is connected
     */
    private async ensureConnection(): Promise<void> {
        if (!this.db) {
            await this.init();
        }
    }

    // ==================== TABLE DATA METHODS ====================

    /**
     * Create generic TableData entry
     */
    async createTableData(data: Partial<TableData>): Promise<number> {
        await this.ensureConnection();
        const entry = {
            ...data,
            columns: data.columns || [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([TABLE_NAMES.TABLE_DATA], 'readwrite');
            const store = transaction.objectStore(TABLE_NAMES.TABLE_DATA);
            const request = store.add(entry);

            request.onsuccess = () => resolve(request.result as number);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Store a single table row with deduplication logic
     * Reference: background-readable.js line 7336
     */
    async storeTableRow(row: Omit<TableRow, 'id'>): Promise<number | null> {
        await this.ensureConnection();
        const entry = {
            ...row,
            createdAt: Date.now()
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([TABLE_NAMES.TABLE_ROWS], 'readwrite');
            const store = transaction.objectStore(TABLE_NAMES.TABLE_ROWS);
            const request = store.add(entry);

            request.onsuccess = () => resolve(request.result as number);
            request.onerror = (event) => {
                const error = request.error;
                if (error && error.name === 'ConstraintError') {
                    // Duplicate found, ignore silently as per reference
                    event.preventDefault();
                    event.stopPropagation();
                    resolve(null);
                } else {
                    reject(error);
                }
            };
        });
    }

    /**
     * Save/Update extraction result (Ported logic wrapper)
     * This orchestrates the flow: Create/Update Table -> Add Rows -> Update Columns
     */
    async saveExtraction(data: ExtractionResult, options?: { name?: string; jobId?: number; tableDataId?: number; isPreview?: boolean; clearExisting?: boolean }): Promise<number> {
        await this.ensureConnection();
        console.log(`💾 [DBManager] Saving extraction... Items: ${data.items ? data.items.length : 0}, Columns: ${data.columns ? data.columns.length : 0}`);

        let tableDataId = options?.tableDataId;
        const isPreview = options?.isPreview ?? false;
        const items = data.items || [];
        const baseName = options?.name || 'Extraction';
        const name = isPreview
            ? `Preview: ${baseName}`
            : baseName;

        if (tableDataId) {
            console.log(`Update existing TableData ${tableDataId}`);

            // Safeguard: If this table already has production data (not a preview)
            // and we are starting a new job, we MUST NOT overwrite it.
            const existing = await this.getTableData(tableDataId);
            if (existing && existing.metadata?.isPreview !== true) {
                // Check if the existing data belongs to a different job (or if we're starting a new job logic)
                // Use existing.jobId (new field) or fallback to metadata.automationId (old field) for legacy data
                const existingJobId = existing.jobId || (existing.metadata as any)?.automationId;

                if (options?.jobId !== existingJobId) {
                    console.log(`⚠️ [DBManager] Safeguard: tableData ${tableDataId} is a production run for job ${existingJobId}. Creating NEW record instead of overwriting.`);
                    tableDataId = undefined; // Force create new
                }
            }
        }

        if (tableDataId) {
            // Re-check after strength safeguard reset
            console.log(`Updating TableData ${tableDataId}`);

            // Clear rows if requested (to prevent duplication between preview and final)
            if (options?.clearExisting) {
                console.log(`🧹 [DBManager] Clearing existing rows for TableID: ${tableDataId}`);
                await this.clearTableRows(tableDataId);
            }

            await this.updateTableData(tableDataId, {
                name: name,
                jobId: options?.jobId,
                metadata: {
                    extractionType: data.type || 'list',
                    totalRows: items.length,
                    isPreview: isPreview,
                    // automationId: options?.automationId // Removed redundant metadata
                }
            });
        }
        else {
            // 1. Create Table Data
            tableDataId = await this.createTableData({
                name: name,
                sourceUrl: data.source_url || (typeof window !== 'undefined' ? window.location.href : 'unknown'),
                jobId: options?.jobId,
                metadata: {
                    extractionType: data.type || 'list',
                    totalRows: items.length,
                    isPreview: isPreview
                }
            });
        }

        // 2. Store Rows
        if (items.length > 0) {
            console.log(`📝 [DBManager] Storing ${items.length} rows for TableID: ${tableDataId}`);
            for (const item of items) {
                // We need to generate a hash for the item to work with the unique index
                // The item here is likely the Normalized row (e.g. { "col1": "val" })
                // We strictly need a consistent hash.
                const dataHash = this.hashData(item);

                await this.storeTableRow({
                    tableDataId: tableDataId,
                    data: item,
                    dataHash: dataHash, // Important for Unique Index
                    metadata: {
                        originalData: item // Store full item if needed
                    }
                } as any); // Casting as we added dataHash dynamically to schema
            }
        }

        // 3. Update Columns (Merge)
        if (data.columns && data.columns.length > 0) {
            console.log(`📊 [DBManager] Updating ${data.columns.length} columns for TableID: ${tableDataId}`);
            await this.updateTableColumns(tableDataId, data.columns);
        }

        console.log(`✅ [DBManager] Extraction saved successfully. TableID: ${tableDataId}`);
        return tableDataId;
    }

    // Helper for hashing data (consistent with reference/data aggregator)
    private hashData(data: any): string {
        const sorted = this.sortObjectKeys(data);
        const json = JSON.stringify(sorted);
        let hash = 0;
        for (let i = 0; i < json.length; i++) {
            hash = ((hash << 5) - hash) + json.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString();
    }

    private sortObjectKeys(obj: any): any {
        if (typeof obj !== 'object' || obj === null) return obj;
        if (Array.isArray(obj)) return obj.map(item => this.sortObjectKeys(item));
        return Object.keys(obj).sort().reduce((result: any, key) => {
            result[key] = this.sortObjectKeys(obj[key]);
            return result;
        }, {});
    }

    /**
     * Get table  data by ID
     */
    async getTableData(id: number): Promise<TableData | null> {
        await this.ensureConnection();
        console.log(`🔍 [DBManager] getTableData called for ID: ${id}`);

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([TABLE_NAMES.TABLE_DATA], 'readonly');
            const store = transaction.objectStore(TABLE_NAMES.TABLE_DATA);
            const request = store.get(id);

            request.onsuccess = () => {
                const result = request.result;
                console.log(`✅ [DBManager] getTableData result for ID ${id}:`, result ? 'Found' : 'Not Found');
                resolve(result || null);
            };
            request.onerror = () => {
                console.error(`❌ [DBManager] getTableData error for ID ${id}:`, request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Update TableData entry
     */
    async updateTableData(id: number, updates: Partial<TableData>): Promise<void> {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([TABLE_NAMES.TABLE_DATA], 'readwrite');
            const store = transaction.objectStore(TABLE_NAMES.TABLE_DATA);
            const request = store.get(id);

            request.onsuccess = () => {
                const data = request.result;
                if (!data) return reject(new Error('TableData not found'));

                const updated = {
                    ...data,
                    ...updates,
                    metadata: {
                        ...data.metadata,
                        ...updates.metadata
                    },
                    updatedAt: Date.now()
                };

                const putRequest = store.put(updated);
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = () => reject(putRequest.error);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get all table data entries
     */
    async getAllTableData(limit = 50): Promise<TableData[]> {
        await this.ensureConnection();
        console.log('🔍 [DBManager] getAllTableData called. Limit:', limit);

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([TABLE_NAMES.TABLE_DATA], 'readonly');
            const store = transaction.objectStore(TABLE_NAMES.TABLE_DATA);

            // Check index existence for debug
            if (!store.indexNames.contains('createdAt')) {
                console.error('❌ [DBManager] "createdAt" index MISSING in TABLE_DATA store!');
            } else {
                console.log('✅ [DBManager] "createdAt" index exists.');
            }

            const index = store.index('createdAt');
            const request = index.openCursor(null, 'prev');

            const results: TableData[] = [];
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    console.log(`✅ [DBManager] getAllTableData returning ${results.length} entries.`);
                    resolve(results);
                }
            };
            request.onerror = () => {
                console.error('❌ [DBManager] getAllTableData failed:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get rows for a specific table
     */
    async getTableRows(tableDataId: number): Promise<TableRow[]> {
        await this.ensureConnection();
        console.log(`🔍 [DBManager] getTableRows called for TableID: ${tableDataId}`);

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([TABLE_NAMES.TABLE_ROWS], 'readonly');
            const store = transaction.objectStore(TABLE_NAMES.TABLE_ROWS);
            const index = store.index('tableDataId');
            const request = index.getAll(tableDataId);

            request.onsuccess = () => {
                const results = request.result || [];
                console.log(`✅ [DBManager] getTableRows returned ${results.length} rows for TableID: ${tableDataId}`);
                resolve(results);
            };
            request.onerror = () => {
                console.error(`❌ [DBManager] getTableRows error for TableID ${tableDataId}:`, request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get table data with its rows
     */
    async getTableColumnsAndRows(
        tableDataId: number
    ): Promise<{ columns: Column[]; data: TableRow[] }> {
        const tableData = await this.getTableData(tableDataId);
        const rows = await this.getTableRows(tableDataId);

        return {
            columns: tableData?.columns || [],
            data: rows,
        };
    }

    /**
     * Update table columns (merges with existing columns by ID)
     * Reference: background-readable.js line 7233
     */
    async updateTableColumns(tableDataId: number, newColumns: Column[]): Promise<boolean> {
        await this.ensureConnection();

        if (!Array.isArray(newColumns) || newColumns.length === 0) {
            return false;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([TABLE_NAMES.TABLE_DATA], 'readwrite');
            const store = transaction.objectStore(TABLE_NAMES.TABLE_DATA);
            const getRequest = store.get(tableDataId);

            getRequest.onsuccess = () => {
                const tableData = getRequest.result;
                if (!tableData) {
                    reject(new Error(`Table data with ID ${tableDataId} not found`));
                    return;
                }

                let mergedColumns = newColumns;

                // Merge with existing columns using Map (reference line 7244-7248)
                if (tableData.columns && Array.isArray(tableData.columns)) {
                    const columnMap = new Map<string, Column>(tableData.columns.map((col: Column) => [col.id, col]));

                    // Add/update new columns
                    newColumns.forEach(col => {
                        columnMap.set(col.id, col);
                    });

                    mergedColumns = Array.from(columnMap.values()) as Column[];
                }

                const updatedTableData = {
                    ...tableData,
                    columns: mergedColumns,
                    updatedAt: Date.now()
                };

                const putRequest = store.put(updatedTableData);

                putRequest.onsuccess = () => {
                    resolve(true);
                };

                putRequest.onerror = () => {
                    reject(putRequest.error);
                };
            };

            getRequest.onerror = () => {
                reject(getRequest.error);
            };
        });
    }

    /**
     * Delete table data and all its rows
     */
    async deleteTableData(id: number): Promise<void> {
        await this.ensureConnection();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(
                [TABLE_NAMES.TABLE_DATA, TABLE_NAMES.TABLE_ROWS],
                'readwrite'
            );

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);

            // Delete table data
            transaction.objectStore(TABLE_NAMES.TABLE_DATA).delete(id);

            // Delete all rows
            const rowStore = transaction.objectStore(TABLE_NAMES.TABLE_ROWS);
            const index = rowStore.index('tableDataId');
            const request = index.openCursor(IDBKeyRange.only(id));

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
        });
    }

    /**
     * Delete all rows associated with a table ID
     */
    async clearTableRows(tableDataId: number): Promise<void> {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([TABLE_NAMES.TABLE_ROWS], 'readwrite');
            const rowStore = transaction.objectStore(TABLE_NAMES.TABLE_ROWS);
            const index = rowStore.index('tableDataId');
            const request = index.openCursor(IDBKeyRange.only(tableDataId));

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    }



    // ==================== NEW V4 METHODS (RECIPES & JOBS) ====================

    /**
     * Get all jobs (with optional recipe hydration if needed in future)
     */
    async getAllJobs(limit = 100): Promise<(Job & { recipe?: AutomationRecipe })[]> {
        await this.ensureConnection();
        const jobs = await new Promise<Job[]>((resolve, reject) => {
            const transaction = this.db!.transaction([NEW_TABLE_NAMES.JOBS], 'readonly');
            const store = transaction.objectStore(NEW_TABLE_NAMES.JOBS);
            const index = store.index('createdAt');
            const request = index.openCursor(null, 'prev');

            const results: Job[] = [];
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });

        // Hydrate recipes for UI convenience
        const recipeIds = [...new Set(jobs.map(j => j.recipeId))];
        const recipes = await Promise.all(recipeIds.map(id => this.getRecipe(id)));
        const recipeMap = new Map(recipes.filter(r => r).map(r => [r!.id!, r!]));

        return jobs.map(j => ({
            ...j,
            recipe: recipeMap.get(j.recipeId)
        }));
    }

    async getRecipe(id: number): Promise<AutomationRecipe | null> {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([NEW_TABLE_NAMES.RECIPES], 'readonly');
            const store = transaction.objectStore(NEW_TABLE_NAMES.RECIPES);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async createRecipe(recipe: AutomationRecipe): Promise<number> {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([NEW_TABLE_NAMES.RECIPES], 'readwrite');
            const store = transaction.objectStore(NEW_TABLE_NAMES.RECIPES);
            const request = store.add(recipe);
            request.onsuccess = () => resolve(request.result as number);
            request.onerror = () => reject(request.error);
        });
    }

    async createJob(job: Job): Promise<number> {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([NEW_TABLE_NAMES.JOBS], 'readwrite');
            const store = transaction.objectStore(NEW_TABLE_NAMES.JOBS);
            const request = store.add(job);
            request.onsuccess = () => resolve(request.result as number);
            request.onerror = () => reject(request.error);
        });
    }

    async updateJob(id: number, updates: Partial<Job>): Promise<void> {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([NEW_TABLE_NAMES.JOBS], 'readwrite');
            const store = transaction.objectStore(NEW_TABLE_NAMES.JOBS);
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const job = getRequest.result;
                if (!job) return reject(new Error('Job not found'));
                const updated = { ...job, ...updates, updatedAt: Date.now() };
                store.put(updated).onsuccess = () => resolve();
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }
}

// Create singleton instance
export const db = new DBManager();

// Export types for convenience
export type { Column } from '../types/database';
