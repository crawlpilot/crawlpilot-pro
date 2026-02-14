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

        if (result.success && result.data) {
            this.addSuccessfulResult(result);
        } else {
            this.addFailedResult(result);
        }
    }

    addSuccessfulResult(result: ProcessedElementResult) {
        const { data, columns } = result;
        if (columns) {
            this.columns.push(...columns);
        }

        if (data.columns && data.item) {
            // Nested or complex result?
            Object.entries(data.item).forEach(([key, value]) => {
                this.item[key] = value;
            });
            this.totalItemCount += Object.keys(data.item).length;
        } else {
            // Simple value result
            // Use elementId as key for the item object
            this.item[result.elementId] = data.value;
            this.totalItemCount += 1;
        }
    }

    addFailedResult(result: ProcessedElementResult) {
        this.columns.push({
            id: result.elementId,
            originalId: result.elementId,
            name: result.elementName,
            type: 'text',
            elementId: result.elementId,
            elementName: result.elementName
        });
        this.item[result.elementId] = null;
    }

    getResult() {
        return {
            columns: this.columns,
            item: this.item,
            elementResults: this.elementResults,
            totalItemCount: this.totalItemCount,
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
            item,
            elementResults: aggregatedResult.elementResults
        };
    }
}
