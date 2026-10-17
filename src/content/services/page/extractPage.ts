import { ElementDefinition, ExtractionConfig } from './types';
import { ElementProcessor } from './processors/ElementProcessor';
import { buildPageRecord } from './processors/columnHelpers';

/**
 * Extracts a Page Extractor recipe's elements from this page into one record: scalars as fields,
 * each list shaped by the list output setting (nested, one row per item, or numbered columns).
 */
export async function extractPage(elements: ElementDefinition[], config: ExtractionConfig) {
    const processor = new ElementProcessor(config);
    const columns: any[] = [];
    const data: Record<string, any> = {};

    for (const element of elements) {
        const result = await processor.processElement(element);

        result.columns?.forEach((col: any) => {
            if (!columns.find(c => c.id === col.id)) columns.push(col);
        });

        if (!result.success || !result.data) {
            data[element.id] = null;
            continue;
        }
        if (Array.isArray(result.data.items)) {
            data[element.id] = {
                __type: result.data.type === 'table' ? 'table' : 'list',
                items: result.data.items,
                columns: result.columns || result.data.columns || []
            };
        } else {
            // A scalar, or a table collapsed to JSON (plus its raw data).
            data[element.id] = result.data[element.id] ?? result.data.value ?? null;
            const rawKey = element.id + '__tabledata';
            if (result.data[rawKey] !== undefined) data[rawKey] = result.data[rawKey];
        }
    }

    return buildPageRecord(data, columns, config?.listOutput);
}
