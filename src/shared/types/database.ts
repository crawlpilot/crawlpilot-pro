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

// Extraction result format
export interface ExtractionResult {
    columns: Column[];
    items: Array<Record<string, any>>;
    source_url: string;
    type?: string;
    count?: number;
    timestamp?: string;
}

// --- Recipes and runs (schema v6, shared/db/schema.ts) ---

/** Selectors for one target, best first: CSS or XPath (told apart by `looksLikeXPath`), at most three. */
export type Chain = string[];

/** One picked list: its container, its items (relative to the container) and the fields read from each item. */
export interface ListTarget {
    id: string;
    container: Chain;
    items: Chain;
    /** The list's frozen fields (`ReaderColumn`s: columns carrying their readers). */
    fields: Column[];
    /** How it was picked: a list of items, or a single element read like one item. */
    mode: 'list' | 'single';
}

export interface ListSpec {
    kind: 'list';
    lists: ListTarget[];
    pagination: {
        mode: 'auto' | 'pagination' | 'loadMore';
        /** The Next / Load more control. */
        next?: Chain;
        speed?: import('../constants/paginationConfig').PaginationSpeed;
    };
}

/** One Page Extractor element: read (or clicked) on every page of a bulk run. */
export interface PageElement {
    id: string;
    name: string;
    action: 'extract' | 'click';
    /** What is read: text, link, image, list, table, arrays (`ElementProcessor`). */
    type: string;
    selectors: Chain;
    /** A list or table element's frozen fields. */
    fields?: Column[];
}

export interface PageSpec {
    kind: 'page';
    elements: PageElement[];
    /** Pacing, viewport and wait settings for the run (`RunSettings` and the Page Extractor's options). */
    settings: Record<string, unknown>;
}

export interface MetadataSpec {
    kind: 'metadata';
    options: import('./metadata').MetadataExtractOptions;
}

export type RecipeSpec = ListSpec | PageSpec | MetadataSpec;

/** What to extract. One per distinct spec, updated in place (`rev` counts the updates). */
export interface Recipe {
    id?: number;
    name: string;
    spec: RecipeSpec;
    /** Hash of the spec: the same pick saved twice is one recipe. */
    hash: string;
    rev: number;
    createdAt: number;
    updatedAt: number;
}

export type JobStatus = 'running' | 'completed' | 'stopped' | 'failed';

/** One run of a recipe: its inputs and outcome. The recipe is referenced, not copied. */
export interface Job {
    id?: number;
    recipeId: number;
    /** The recipe's revision this run used. */
    recipeRev: number;
    name?: string;
    status: JobStatus;
    input: {
        /** Where it ran: the list page, or every page of a bulk / metadata run. */
        urls: string[];
        maxPages?: number;
        concurrency?: number;
    };

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
        pageStats?: import('../listing/runStats').PageStat[];
        duplicatesRemoved?: number;
        /** Share of rows each field filled (listing runs), most-filled first. */
        coverage?: { name: string; fill: number }[];
    };

    /** The table the run wrote. */
    tableId?: number;
    error?: string;
    createdAt: number;
    updatedAt: number;
}
