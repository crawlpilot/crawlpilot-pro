import { ElementProcessor } from '../processors/ElementProcessor';
import { ExtractionConfig, ElementDefinition, ProcessedElementResult } from '../types';

class Aggregator {
    columns: any[] = [];
    item: any = {};
    elementResults: ProcessedElementResult[] = [];
    totalItemCount = 0;

    constructor() {
        this.reset();
    }

    reset() {
        this.columns = [];
        this.item = {};
        this.elementResults = [];
        this.totalItemCount = 0;
    }

    addElementResult(result: ProcessedElementResult) {
        this.elementResults.push({
            elementId: result.elementId,
            elementName: result.elementName,
            success: result.success,
            error: result.error,
            data: result.data
        });

        const { data, columns } = result;
        if (columns) {
            // Avoid duplicates in columns
            columns.forEach(col => {
                if (!this.columns.find(c => c.id === col.id)) {
                    this.columns.push(col);
                }
            });
        }

        if (result.success && data) {
            if (data.type === 'table' && data.items) {
                // TABLE: each item becomes its own output row
                this.item[result.elementId] = { __type: 'table', items: data.items, columns: data.columns || [] };
                this.totalItemCount = Math.max(this.totalItemCount, data.items.length);
            } else if (data.type === 'list' && data.items) {
                // LIST: all items flattened into ONE row as indexed columns
                // e.g. [{title:"A",price:"10"},{title:"B"}] → {list_1_title:"A",list_1_price:"10",list_2_title:"B"}
                const flatRow: any = {};
                const flatColumns: any[] = [];
                data.items.forEach((item: any, idx: number) => {
                    const prefix = `${result.elementName}_${idx + 1}`;
                    Object.entries(item).forEach(([key, val]) => {
                        const colId = `${result.elementId}_${idx + 1}_${key}`;
                        flatRow[colId] = val;
                        flatColumns.push({
                            id: colId,
                            originalId: colId,
                            name: `${prefix} ${key}`,
                            type: 'text',
                            elementId: result.elementId,
                            elementName: result.elementName
                        });
                    });
                });
                // Store as a flat single value (merge into item record)
                this.item[result.elementId] = { __type: 'list_flat', flatRow, flatColumns };
                if (this.totalItemCount === 0) this.totalItemCount = 1;
            } else {
                // Simple scalar value result
                this.item[result.elementId] = data.value;
                if (this.totalItemCount === 0) this.totalItemCount = 1;
            }
        } else {
            // Failed element
            this.item[result.elementId] = null;
            if (!this.columns.find(c => c.id === result.elementId)) {
                this.columns.push({
                    id: result.elementId,
                    originalId: result.elementId,
                    name: result.elementName,
                    type: 'text',
                    elementId: result.elementId,
                    elementName: result.elementName
                });
            }
        }
    }

    getResult() {
        const recordId = `rec_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        const recordIdColumn = {
            id: 'recordId',
            originalId: 'recordId',
            name: 'RECORD ID',
            type: 'text',
            elementId: 'recordId',
            elementName: 'Record Identifier'
        };

        // Check if any element returned table rows (needs row explosion)
        const hasTableElement = Object.values(this.item).some(
            (v: any) => v && typeof v === 'object' && v.__type === 'table'
        );

        if (hasTableElement) {
            // TABLE mode: explode table items into individual rows (all sharing recordId)
            // Other scalar / list_flat fields are merged into every row
            const rows: any[] = [];
            let allColumns: any[] = [recordIdColumn];

            // First, collect all non-table fields (scalars + list_flat) for merging
            const baseRow: any = { recordId };
            const baseColumns: any[] = [];

            Object.entries(this.item).forEach(([key, value]: [string, any]) => {
                if (!value || value.__type !== 'table') {
                    if (value && value.__type === 'list_flat') {
                        Object.assign(baseRow, value.flatRow);
                        baseColumns.push(...value.flatColumns);
                    } else {
                        baseRow[key] = value;
                        const existingCol = this.columns.find(c => c.id === key);
                        if (existingCol) baseColumns.push(existingCol);
                    }
                }
            });

            // Now explode each table element into rows
            Object.entries(this.item).forEach(([, value]: [string, any]) => {
                if (value && value.__type === 'table') {
                    // Merge table-level columns
                    (value.columns || []).forEach((col: any) => {
                        if (!allColumns.find(c => c.id === col.id)) allColumns.push(col);
                    });
                    // Each item in the table is a row
                    value.items.forEach((tableRow: any) => {
                        rows.push({ ...baseRow, ...tableRow });
                    });
                }
            });

            allColumns = [recordIdColumn, ...baseColumns, ...allColumns.filter(c => c.id !== 'recordId')];

            return {
                columns: allColumns,
                items: rows.length > 0 ? rows : [{ ...baseRow }],
                elementResults: this.elementResults,
                totalItemCount: rows.length,
                successfulElements: this.elementResults.filter(r => r.success).length,
                failedElements: this.elementResults.filter(r => !r.success).length
            };
        }

        // No table: build a single row from scalars and list_flat columns
        const singleRow: any = { recordId };
        const singleColumns: any[] = [recordIdColumn];

        Object.entries(this.item).forEach(([key, value]: [string, any]) => {
            if (value && typeof value === 'object' && value.__type === 'list_flat') {
                // LIST mode: all items flattened into columns of this one row
                Object.assign(singleRow, value.flatRow);
                singleColumns.push(...value.flatColumns);
            } else {
                // Scalar
                singleRow[key] = value;
                const col = this.columns.find(c => c.id === key);
                if (col) singleColumns.push(col);
            }
        });

        return {
            columns: singleColumns,
            item: singleRow,
            elementResults: this.elementResults,
            totalItemCount: 1,
            successfulElements: this.elementResults.filter(r => r.success).length,
            failedElements: this.elementResults.filter(r => !r.success).length
        };
    }
}

export class PageExtractionStrategy {
    private processor: ElementProcessor;
    private aggregator: Aggregator;

    constructor(
        private url: string,
        private elements: ElementDefinition[],
        private config: ExtractionConfig
    ) {
        this.processor = new ElementProcessor(config);
        this.aggregator = new Aggregator();
    }

    async extractElements(): Promise<any> {
        if (!this.elements || !Array.isArray(this.elements) || this.elements.length === 0) {
            return this.createEmptyResult(this.url);
        }

        this.aggregator.reset();

        for (const element of this.elements) {
            const result = await this.processor.processElement(element);
            this.aggregator.addElementResult(result);

            if (this.config?.delayBetweenElements && this.config.delayBetweenElements > 0) {
                await new Promise(resolve => setTimeout(resolve, this.config.delayBetweenElements));
            }
        }

        const aggregatedResult = this.aggregator.getResult();
        return this.createSuccessResult(this.url, aggregatedResult);
    }

    private createEmptyResult(url: string) {
        return {
            url,
            success: true,
            extractedAt: Date.now(),
            itemCount: 0,
            columns: [{
                id: 'url',
                originalId: 'url',
                name: 'PAGE URL',
                type: 'link',
                elementId: 'url',
                elementName: 'Source URL'
            }],
            item: { url },
            elementResults: []
        };
    }

    private createSuccessResult(url: string, aggregatedResult: any) {
        const columns = [{
            id: 'url',
            originalId: 'url',
            name: 'PAGE URL',
            type: 'link',
            elementId: 'url',
            elementName: 'Source URL'
        }, ...aggregatedResult.columns];

        if (aggregatedResult.items) {
            // Multi-row result (list expansion)
            const items = aggregatedResult.items.map((item: any, index: number) => ({
                url: index === 0 ? url : null,
                ...item
            }));

            return {
                url,
                success: true,
                extractedAt: Date.now(),
                itemCount: aggregatedResult.totalItemCount,
                columns,
                items, // Return array
                elementResults: aggregatedResult.elementResults
            };
        }

        // Single row result
        const item = {
            url,
            ...aggregatedResult.item
        };

        return {
            url,
            success: true,
            extractedAt: Date.now(),
            itemCount: aggregatedResult.totalItemCount,
            columns,
            item, // Return single object
            elementResults: aggregatedResult.elementResults
        };
    }
}
