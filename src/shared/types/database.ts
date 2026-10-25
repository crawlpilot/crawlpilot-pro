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

/** A column built from others in the data table ("Merge columns"). */
export interface ColumnMerge {
    id: string;
    name: string;
    sources: string[];
    separator: string;
}

/** Column → output-schema mapping chosen in "JSON to a schema". */
export interface OutputMapping {
    contractId: string;
    customText?: string;
    mapping: Record<string, string | null>;
}

/** A dataset: what a run (or a preview, an API capture) wrote. */
export interface Table {
    id?: number;
    name: string;
    /** The job that wrote it; none for previews and captures. */
    jobId?: number;
    /** What wrote it: `list`, `bulk-page`, `metadata-extraction`, `api`. */
    source: string;
    sourceUrl: string;
    /** The run's columns, replaced as a whole (never merged). */
    columns: Column[];
    /** Rows actually stored. */
    rowCount: number;
    /** A preview of a pick: replaced by the next one, or promoted when the run writes into it. */
    preview: boolean;
    /** How the data table shows it: the user's merged and typed columns and export mapping. */
    view: {
        merges?: ColumnMerge[];
        typed?: TypedColumnDef[];
        mapping?: OutputMapping;
        /** Columns the user renamed (id → name) and removed: kept when a run still writing replaces the columns. */
        renames?: Record<string, string>;
        removed?: string[];
        /** Its items' details, joined on from a details run's table (`listing/join.ts`). */
        details?: { tableId: number; urlColumn: string; matched: number; unmatched: number; at: number };
        /** A rerun that kept only the items the earlier run's table didn't have. */
        onlyNew?: { against: number; removed: number; at: number };
        /** Sent to the user's Google Sheet: its tab, rows sent so far, and whether new rows follow (`shared/integrations/sheetsSync.ts`). */
        sheet?: { tab: string; synced: number; sync: boolean; url?: string; error?: string };
    };
    createdAt: number;
    updatedAt: number;
}

/** One row of a table, stored once. */
export interface Row {
    id?: number;
    tableId: number;
    data: Record<string, any>;
    /** The row's identity in its table (its data without `source_url` / `recordId`): a repeat is skipped. */
    key: string;
    createdAt: number;
    /** Values the user changed in the data table: each one's value as read, for Revert. */
    edits?: Record<string, unknown>;
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
    /**
     * Each item's page, read after the list and joined onto its row (`listing/join.ts`): the details
     * run's recipe and the list's column of item links. A rerun of the list runs it too.
     */
    details?: { page: PageSpec; urlColumn: string };
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
    /** Where the value is in the page's own data; read before the DOM (`content/services/page/dataBinding.ts`). */
    data?: DataBinding;
    /** The kind of value picked (price, number, text…): a healed match must be the same kind. */
    shape?: import('../extraction/shape').Shape;
}

/** A step of a path into page data: a key, an index, or the array item whose `where` key is `is`. */
export type JsonStep = string | number | { where: string; is: string };

/** A Page Extractor element bound to the page's JSON: the source (kind, label, which of that name) and the path. */
export interface DataBinding {
    kind: 'ld' | 'json' | 'state';
    label: string;
    nth: number;
    /** JSON-LD: the entity's `@type`, found in whichever block has it; `path` is then inside the entity. */
    type?: string;
    path: JsonStep[];
    /**
     * Text; a list of strings; rows of cells (a table), each column read from `keys`; or an object of
     * name → value pairs (`keys`: the items' name key and value key; none for an object of its own).
     */
    as: 'text' | 'list' | 'rows' | 'object';
    /** Attribute keys (`offers.price`, `images[*].url`: `shared/pageJson/path.ts`), one per column. */
    keys?: string[];
    /** Rows picked in "Data on this page": the columns' names, one per key. */
    names?: string[];
    /** Text or a list picked in "Data on this page": the attribute key read inside the value at `path`. */
    key?: string;
    /** The key gives several values and the field wants one: the first that has something. */
    first?: boolean;
    /** Text steps on each value read (`absoluteUrl`, `stripHtml`…): the value made the type the schema asks. */
    ops?: import('../transforms/chain').TransformOp[];
    /** What the page writes around a bare number ("$" before 194). */
    prefix?: string;
    suffix?: string;
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

/** Contacts from websites: each URL a company site, its contact pages followed. */
export interface ContactsSpec {
    kind: 'contacts';
    options: { follow: number; ownOnly?: boolean };
}

/** A site's own JSON API, called again page by page (shared/network/apiRecipe.ts). */
export type ApiSpec = import('../network/apiRecipe').ApiSpec;

export type RecipeSpec = ListSpec | PageSpec | MetadataSpec | ContactsSpec | ApiSpec;

/** What to extract. One per distinct spec, updated in place (`rev` counts the updates). */
export interface Recipe {
    id?: number;
    name: string;
    spec: RecipeSpec;
    /** Hash of the spec: the same pick saved twice is one recipe. */
    hash: string;
    rev: number;
    /**
     * Saved by the user ("Save as recipe", or a ready-made one run): shown on the Recipes screen and
     * kept when its runs are removed. Every run has a recipe; an ad-hoc run's stays out of sight.
     */
    saved?: boolean;
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
        /** Page Extractor runs: each step's result over the pages (`shared/listing/stepStats.ts`). */
        steps?: import('../listing/stepStats').StepStat[];
        /** Runs: the computer struggled, so the run went on with fewer tabs at once (`JobRunner.easeOff`). */
        eased?: { to: number; reason: string };
    };

    /** The table the run wrote. */
    tableId?: number;
    error?: string;
    createdAt: number;
    updatedAt: number;
}
