import { ExtractionResult, Column } from './ExtractionTypes';
import { SchemaGenerator } from './SchemaGenerator';

export class DataAggregator {
    private rawRows: any[] = [];
    private duplicateCount = 0;
    private seenHashes = new Set<string>();
    private schemaGenerator: SchemaGenerator;

    constructor() {
        this.schemaGenerator = new SchemaGenerator();
    }

    /**
     * Add raw rows to the aggregator with deduplication
     */
    public addRows(rows: any[]) {
        rows.forEach(row => {
            const hash = this.hashData(row);
            if (this.seenHashes.has(hash)) {
                this.duplicateCount++;
            } else {
                this.seenHashes.add(hash);
                this.rawRows.push(row);
            }
        });
    }

    /**
     * Generate simple hash for deduplication
     */
    private hashData(row: any): string {
        try {
            return JSON.stringify(Object.keys(row).sort().reduce((obj: any, key) => {
                obj[key] = row[key];
                return obj;
            }, {}));
        } catch (e) {
            return JSON.stringify(row);
        }
    }

    public clear() {
        this.rawRows = [];
        this.duplicateCount = 0;
        this.seenHashes.clear();
    }

    public getRawRows() {
        return this.rawRows;
    }

    public getDistinctCount() {
        return this.rawRows.length;
    }

    /**
     * Get final unified results with schema application
     * @param type Extraction type (list/single)
     * @param sourceUrl Page URL
     * @param columns Optional schema to enforce (from preview)
     */
    public getUnifiedResults(type: 'list' | 'single', sourceUrl: string, columns?: Column[]): ExtractionResult {
        // 1. Generate Schema Strategy
        let finalColumns: Column[] = [];
        let items: any[] = [];

        if (columns && columns.length > 0) {
            // ENFORCEMENT MODE: Use provided columns
            // We map raw data to these columns using originalId (selector path)
            finalColumns = columns;

            items = this.rawRows.map(row => {
                const newRow: any = {};
                // Iterate ROW KEYS to map them to columns via normalized ID
                Object.keys(row).forEach(rawKey => {
                    const colId = this.schemaGenerator.getColumnId(rawKey);
                    // Check if this ID matches any of our target columns
                    if (finalColumns.find(c => c.id === colId)) {
                        newRow[colId] = row[rawKey];
                    }
                });
                return newRow;
            });

        } else {
            // DISCOVERY MODE: Generate union schema
            const schemaResult = this.schemaGenerator.generateSchema(this.rawRows);
            finalColumns = schemaResult.columns;

            // Map raw rows to new schema IDs
            items = this.rawRows.map(row => {
                const newRow: any = {};
                // Iterate ROW KEYS to map them to columns via normalized ID
                Object.keys(row).forEach(rawKey => {
                    const colId = this.schemaGenerator.getColumnId(rawKey);
                    // Check if this ID exists in our newly generated schema
                    if (finalColumns.find(c => c.id === colId)) {
                        newRow[colId] = row[rawKey];
                    }
                });
                return newRow;
            });
        }

        return {
            type,
            columns: finalColumns,
            items: items,
            source_url: sourceUrl,
            count: items.length,
            timestamp: new Date().toISOString(),
            metadata: {
                duplicatesRemoved: this.duplicateCount,
                uniqueItems: items.length
            }
        };
    }
}
