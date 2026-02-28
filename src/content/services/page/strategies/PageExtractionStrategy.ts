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
            if (data.type === 'list' && data.items) {
                // This element produced a list of items
                // Store it separately to handle "explosion" in getResult
                this.item[result.elementId] = data.items;
                this.totalItemCount = Math.max(this.totalItemCount, data.items.length);
            } else {
                // Simple value result
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
        // "Explosion" logic: 
        // If we have any list fields, we want to create N items where N is the max list length.
        // Single fields should be repeated for each item, but the user requested:
        // 1. Add a unique id to track what rows belong to a particular record.
        // 2. Avoid duplicate content in rows (parent fields only in first row).

        const hasList = Object.values(this.item).some(v => Array.isArray(v));
        const recordId = `rec_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        const recordIdColumn = {
            id: 'recordId',
            originalId: 'recordId',
            name: 'RECORD ID',
            type: 'text',
            elementId: 'recordId',
            elementName: 'Record Identifier'
        };

        if (!hasList) {
            return {
                columns: [recordIdColumn, ...this.columns],
                item: { ...this.item, recordId },
                elementResults: this.elementResults,
                totalItemCount: this.totalItemCount,
                successfulElements: this.elementResults.filter(r => r.success).length,
                failedElements: this.elementResults.filter(r => !r.success).length
            };
        }

        // ... We have lists ...
        const rows: any[] = [];
        const maxRows = this.totalItemCount;

        for (let i = 0; i < maxRows; i++) {
            const row: any = { recordId };
            Object.entries(this.item).forEach(([key, value]) => {
                if (Array.isArray(value)) {
                    // It's a list. Use item at index i if it exists.
                    const item = value[i];
                    if (item && typeof item === 'object') {
                        Object.assign(row, item);
                    } else {
                        row[key] = item || null;
                    }
                } else {
                    // It's a single value (parent field).
                    // User requested: avoid duplicate content in rows for explosion.
                    // Only include in the first row.
                    row[key] = (i === 0) ? value : null;
                }
            });
            rows.push(row);
        }

        return {
            columns: [recordIdColumn, ...this.columns],
            items: rows,
            elementResults: this.elementResults,
            totalItemCount: rows.length,
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
