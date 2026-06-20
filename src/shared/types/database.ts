// Database table names
export const TABLE_NAMES = {
    TABLE_DATA: 'tableData',
    TABLE_ROWS: 'tableRows',
} as const;

// Column type definitions
export type ColumnType =
    | 'text'
    | 'number'
    | 'url'
    | 'image'
    | 'image_array'
    | 'email'
    | 'phone'
    | 'date'
    | 'price'
    | 'markdown';

export interface Column {
    id: string;
    name: string;
    type: ColumnType;
    order?: number;
    group?: { id: string; name: string };
    isKeyValue?: boolean;
}

// TableData - metadata for extracted datasets
export interface TableData {
    id?: number;
    name: string;
    columns: Column[];
    sourceUrl: string;
    createdAt: number;
    updatedAt: number;
    jobId?: number; // Renamed from automationId
    metadata?: {
        extractionType?: string;
        totalRows?: number;
        source?: string;
        isPreview?: boolean;
        columnMerges?: Array<{ id: string; name: string; sources: string[]; separator: string }>;
        // automationId removed from metadata as it is redundant
    };
}

// TableRow - individual data rows
export interface TableRow {
    id?: number;
    tableDataId: number;
    data: Record<string, any>;
    createdAt: number;
    metadata?: {
        extractionType?: string;
        sourceUrl?: string;
    };
}

// Automation types
export type AutomationStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'paused';

export type AutomationType =
    | 'list-extraction'
    | 'email-extraction'
    | 'image-download'
    | 'text-extraction'
    | 'bulk-extraction'
    | 'metadata-extraction';

export interface AutomationConfig {
    type: AutomationType;
    urls?: string[];
    selectors?: string[];
    options?: Record<string, any>;
}



// Extraction result format
export interface ExtractionResult {
    columns: Column[];
    items: Array<Record<string, any>>;
    source_url: string;
    type?: string;
    count?: number;
    timestamp?: string;
}

// --- NEW SCHEMA (Refactoring Phase 1) ---

export interface AutomationRecipe {
    id?: number;
    name: string;
    description?: string;
    type: AutomationType;
    version: number;

    // The normalized strategy configuration
    config: AutomationConfig; // Reuse existing config structure for now, can be refined later

    // Scheduling
    schedule?: {
        enabled: boolean;
        cronExpression?: string; // e.g. "0 0 * * *"
        nextRunAt?: number;
    };

    createdAt: number;
    updatedAt: number;
}

export interface Job {
    id?: number;
    recipeId: number; // FK to AutomationRecipe
    name?: string; // [NEW] Optional run-specific name
    status: AutomationStatus;
    sourceUrl?: string; // Where it ran

    // Snapshot of config at run time (in case recipe changes)
    configSnapshot?: AutomationConfig;

    // Performance metrics & Result Metadata
    stats: {
        startTime: number;
        endTime?: number;
        itemsExtracted: number;
        pagesVisited?: number;
        errors?: number;
        stoppedByUser?: boolean;
    };

    result?: {
        tableDataId?: number; // Link to the data
        outputFile?: string;
    };

    error?: string;
    logs?: string[];
    createdAt: number;
    updatedAt: number;
}

export const NEW_TABLE_NAMES = {
    RECIPES: 'recipes',
    JOBS: 'jobs'
} as const;
