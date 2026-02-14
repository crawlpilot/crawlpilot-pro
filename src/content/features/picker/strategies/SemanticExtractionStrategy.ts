import { IExtractionStrategy, ExtractionConfig, RowData } from './IExtractionStrategy';
import { SemanticFieldExtractor } from '../../../services/extraction/SemanticFieldExtractor';

/**
 * Semantic Extraction Strategy
 * Uses AI-like heuristics to detect price, title, rating, etc.
 */
export class SemanticExtractionStrategy implements IExtractionStrategy {
    private semanticExtractor = new SemanticFieldExtractor();

    extract(element: HTMLElement, _config: ExtractionConfig): RowData {
        const semanticFields = this.semanticExtractor.extractFields(element);

        // Calculate average confidence
        const confidenceValues = Object.values(semanticFields.confidence);
        const avgConfidence = confidenceValues.length > 0
            ? confidenceValues.reduce((a: number, b: number) => a + b, 0) / confidenceValues.length
            : 0;

        return {
            data: semanticFields.fields,
            metadata: {
                selector: 'semantic',
                confidence: avgConfidence,
                timestamp: new Date().toISOString()
            }
        };
    }

    getName(): string {
        return 'semantic';
    }
}
