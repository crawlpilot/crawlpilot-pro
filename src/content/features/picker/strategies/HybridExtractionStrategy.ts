import { IExtractionStrategy, ExtractionConfig, RowData } from './IExtractionStrategy';
import { CSSSelectorExtractionStrategy } from './CSSSelectorExtractionStrategy';
import { SemanticExtractionStrategy } from './SemanticExtractionStrategy';

/**
 * Hybrid Extraction Strategy
 * Combines CSS selector extraction (hierarchical) with semantic extraction
 * Semantic fields override hierarchical fields when both exist
 */
export class HybridExtractionStrategy implements IExtractionStrategy {
    private cssStrategy = new CSSSelectorExtractionStrategy();
    private semanticStrategy = new SemanticExtractionStrategy();

    extract(element: HTMLElement, config: ExtractionConfig): RowData {
        // Extract using CSS selectors (captures everything)
        const cssResult = this.cssStrategy.extract(element, config);

        // Extract using semantic detection (unified fields)
        const semanticResult = this.semanticStrategy.extract(element, config);

        // Merge: semantic fields override CSS selector fields
        const mergedData = {
            ...cssResult.data,
            ...semanticResult.data
        };

        return {
            data: mergedData,
            metadata: {
                selector: 'hybrid',
                confidence: semanticResult.metadata.confidence || 0,
                timestamp: new Date().toISOString()
            }
        };
    }

    getName(): string {
        return 'hybrid';
    }
}
