import { ExtractionConfig, ElementDefinition } from './types';
import { PageExtractionStrategy } from './strategies/PageExtractionStrategy';

export class PageExtractor {
    // private isRunning = false;
    // private cancelled = false;

    constructor() { }

    async execute(
        actionType: string,
        url: string,
        elements: ElementDefinition[],
        config: ExtractionConfig,
        _tableDataId?: string
    ): Promise<any> {
        // this.isRunning = true;
        // this.cancelled = false;

        try {
            let strategy;

            switch (actionType) {
                case 'EXTRACT_PAGES':
                    strategy = new PageExtractionStrategy(url, elements, config);
                    break;
                // We can add other strategies (Email, Phone, etc.) here later
                default:
                    throw new Error(`Unsupported extraction type: ${actionType}`);
            }

            const result = await strategy.extractElements();
            return result;

        } catch (error: any) {
            console.error('PageExtractor execution failed:', error);
            return {
                success: false,
                error: error.message,
                url
            };
        } finally {
            // this.isRunning = false;
        }
    }

    cancel() {
        // this.cancelled = true;
        // this.isRunning = false;
    }
}
