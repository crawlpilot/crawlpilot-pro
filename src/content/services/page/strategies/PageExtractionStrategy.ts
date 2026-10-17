import { ElementProcessor } from '../processors/ElementProcessor';
import { ExtractionConfig, ElementDefinition, ProcessedElementResult } from '../types';
import { buildPageRecord, ListOutput } from '../processors/columnHelpers';

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
            if ((data.type === 'table' || data.type === 'list') && data.items) {
                this.item[result.elementId] = { __type: data.type, items: data.items, columns: columns || data.columns || [] };
                if (data.type === 'table') {
                    this.totalItemCount = Math.max(this.totalItemCount, data.items.length);
                } else if (this.totalItemCount === 0) {
                    this.totalItemCount = 1;
                }
            } else {
                // Simple scalar (text, link, image) OR JSON-consolidated table
                this.item[result.elementId] = (data as any)[result.elementId] ?? (data as any).value ?? null;
                const rawKey = result.elementId + '__tabledata';
                if (rawKey in data) this.item[rawKey] = (data as any)[rawKey];
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

    getResult(listOutput?: ListOutput) {
        const record = buildPageRecord(this.item, this.columns, listOutput);

        return {
            columns: record.columns,
            item: record.item,
            items: record.items,
            elementResults: this.elementResults,
            totalItemCount: record.items?.length ?? 1,
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
        // Auto-derive delay between elements from actionSpeed if not explicitly set
        if (!config.delayBetweenElements && config.actionSpeed) {
            config.delayBetweenElements = Math.max(100, Math.round(config.actionSpeed * 0.5));
        }
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

        const aggregatedResult = this.aggregator.getResult(this.config.listOutput);
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
            const items = aggregatedResult.items.map((item: any) => ({ url, ...item }));

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
