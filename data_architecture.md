# Data Persistence & Unification Architecture

This document details the implementation of data storage, schema generation, column unification, and deduplication in the CrawlPilot extension.

## 1. Database Schema (IndexedDB)

The extension uses IndexedDB (`ultimateWebScraperDB`) with version **3**. Data is split into two primary stores to allow efficiently handling large datasets without loading all rows into memory when just listing extractions.

### `TABLE_DATA` Store
Stores metadata about the extraction job and the schema definition.
*   **Key**: `id` (Auto-increment Integer)
*   **Indexes**: `name`, `createdAt`, `automationId`.
*   **Structure**:
    ```typescript
    interface TableData {
        id?: number;
        name: string;
        sourceUrl: string;
        createdAt: number;
        updatedAt: number;
        columns: Column[]; // The generated schema
        automationId?: number;
        metadata?: {
             extractionType: 'list' | 'single';
             totalRows: number;
        }
    }
    ```

### `TABLE_ROWS` Store
Stores the actual extracted data.
*   **Key**: `id` (Auto-increment Integer)
*   **Indexes**:
    *   `tableDataId`: Foreign key to `TABLE_DATA`.
    *   `createdAt`: Timestamp.
    *   `tableData_dataHash`: **Unique Composite Index** (`tableDataId` + `dataHash`) used for database-level deduplication.
*   **Structure**:
    ```typescript
    interface TableRow {
        id?: number;
        tableDataId: number;
        data: Record<string, any>; // Normalized Data (Keys match Column IDs)
        dataHash: string;          // Hash for deduplication
        metadata?: any;            // Original raw data if needed
        createdAt: number;
    }
    ```

---

## 2. Schema Generation & Column Unification

The system treats "Columns" as dynamic entities derived from the raw extracted data (CSS Selectors). This logic is handled by `src/content/engine/extraction/SchemaGenerator.ts`.

### Column ID Generation
To ensure stable column IDs across different scrapes of the same page, we generate IDs deterministically from the **Original Selector Key**.

**Algorithm**:
1.  **Input**: Raw Key (e.g., `div > div > a href`).
2.  **Hashing**: A custom 32-bit integer hash is calculated from the string char codes.
3.  **Encoding**: The absolute hash is converted to **Base36** string (0-9, a-z).
4.  **Format**: The ID is the first 8 characters of this hash string.

**Code Reference** (`SchemaGenerator.ts`):
```typescript
private generateHashId(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36).slice(0, 8);
}
```

### Column Naming & Type Inference
Column names are inferred from the selector suffix and path:
-   `... href` → **URL** (Type: `url`)
-   `... src` → **Image** (Type: `image`)
-   `price` in path → **Price** (Type: `price`)
-   `title` or `heading` in path → **Title** (Type: `text`)

### Unification Strategy
When adding new data (e.g., Infinite Scroll), we do **not** blindly append columns.
1.  **Discovery**: We generate a fresh schema for the new batch of rows.
2.  **Merge**: In `db-manager.ts`, we merge new columns into the existing `TABLE_DATA.columns` list.
    *   We use a `Map<ColumnID, Column>` to ensure uniqueness.
    *   If a Column ID exists, the existing definition is preserved (stable headers).
    *   New IDs are appended.

---

## 3. Data Flow & Normalization

A critical part of the pipeline is ensuring that raw extracted data (keyed by CSS selectors) is converted to normalized data (keyed by Column IDs) **before** storage.

### The Problem (Raw vs. Normalized)
*   **Raw Data**: `{ "div > a href": "http://example.com" }`
*   **Schema**: `{ id: "x9z1a", originalId: "div > a href", name: "Link" }`
*   **Normalized Data**: `{ "x9z1a": "http://example.com" }`

**Crucial Step**: The `DataTable` UI component expects Keys to be **Column IDs**. If you save Raw Data, the UI will render blank rows.

### Implementation Flow

1.  **Extraction**: `DataExtractor` scrapes DOM and produces Raw Rows.
2.  **Aggregation**: `DataAggregator` accumulates rows.
    *   *Correction*: `DataAggregator.getUnifiedResults()` performs normalization locally.
3.  **Auto-Scroll (Streaming)**:
    *   `element-selector.ts` receives raw rows from the scraper.
    *   **Normalization Fix**: Before sending the `AUTO_SCROLL_COMPLETE` message, it generates a schema and **remaps** all keys from `originalId` to `column.id`.
    *   This ensures the payload sent to `saveExtraction` is fully normalized.
4.  **Persistence**:
    *   `db.saveExtraction(normalizedData)` is called.
    *   It creates the `TableData` entry with the Schema.
    *   It iterates over the `normalizedData.items` and stores them in `TABLE_ROWS`.

---

## 4. Row Deduplication Logic

Deduplication happens at two levels: **InMemory** (during extraction) and **Database** (persistent).

### Hashing Algorithm
We define the "uniqueness" of a row by its content.
**Code Reference** (`DataAggregator.ts` / `db-manager.ts`):
```typescript
private hashData(row: any): string {
    // Sort keys to ensure {a:1, b:2} == {b:2, a:1}
    const sorted = Object.keys(row).sort().reduce((obj, key) => {
        obj[key] = row[key];
        return obj;
    }, {});
    return JSON.stringify(sorted);
}
```

### Deduplication Layers

1.  **In-Memory Aggregator**:
    *   Maintains a `Set<string>` of seen hashes.
    *   Drops duplicates instantly during the scroll session.
    *   Prevents processing the same visible item multiple times if the scroller jitters.

2.  **Database Constraint**:
    *   Used when appending data to an existing dataset (e.g., resuming a crawl).
    *   The `TABLE_ROWS` store has a unique index: `store.createIndex('tableData_dataHash', ['tableDataId', 'dataHash'], { unique: true });`.
    *   If we attempt to `put` a row with the same Hash for the same TableID, IndexedDB throws a constraint error (which we catch and ignore).
    *   This guarantees zero duplicates in the final storage.

## Summary

| Component | Responsibility | Key Logic |
| :--- | :--- | :--- |
| **SchemaGenerator** | Define Columns | `Base36Hash(Selector) -> ColumnID` |
| **DataAggregator** | Buffer Rows | `JSON(SortedKeys) -> RowHash` |
| **ElementSelector** | Stream Control | **Normalization**: `Raw[OriginalID] -> Normalized[ColID]` |
| **DBManager** | Storage | **Unique Index**: `[TableID, RowHash]` |
