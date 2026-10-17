// Column type definitions
export type ColumnType =
    | 'text'
    | 'number'
    | 'url'
    | 'image'
    | 'email'
    | 'phone'
    | 'date'
    | 'price'
    | 'markdown'
    | 'image_array'
    | 'text_array'
    | 'link_array'
    /** A list or table element's rows, as JSON (Page Extractor). */
    | 'json'
    /** Hidden raw rows behind a `json` table column. */
    | 'tabledata';

/** One column of extracted data: the single column type, from picking to the data table and export. */
export interface Column {
    id: string;
    name: string;
    type: ColumnType;
    order?: number;
    /** The row-relative selector a list field reads (shown in the field editor). */
    selector?: string;
    group?: { id: string; name: string };
    isKeyValue?: boolean;
    hidden?: boolean;
    /** The Page Extractor element the column came from. */
    elementId?: string;
    elementName?: string;
}

export interface TypedColumnDef {
    id: string;
    name: string;
    source: string;
    type: import('../transforms/chain').FieldType;
    ops: import('../transforms/chain').TransformOp[];
    dayFirst?: boolean;
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
        /** Column → output-schema mapping chosen in "JSON to a schema". */
        outputMapping?: { contractId: string; customText?: string; mapping: Record<string, string | null> };
        /** Typed columns derived from a source column by a transform chain (shared/transforms). */
        columnTypes?: TypedColumnDef[];
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
        /** Page verdict counts for the run (see shared/verdict/classifyPage). */
        verdicts?: Record<string, number>;
        /** Listing runs: why the run ended, rows/duplicates per page, total duplicates skipped. */
        stopReason?: string;
        pageStats?: { page: number; rows: number; duplicates: number; unmapped?: number }[];
        duplicatesRemoved?: number;
        /** Share of rows each field filled (listing runs), most-filled first. */
        coverage?: { name: string; fill: number }[];
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
