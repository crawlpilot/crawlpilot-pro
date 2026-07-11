import { ElementDefinition, ExtractionResult } from '../types';

/**
 * Shared between ElementProcessor and BackgroundElementProcessor — byte-for-byte identical
 * in both before this extraction. Builds the column definitions for one element's result,
 * grouping list/smart/table columns under the element's name.
 */
export function extractColumns(elementDef: ElementDefinition, actionResult: ExtractionResult): any[] {
    // Table elements are JSON-consolidated: one visible JSON column + one hidden raw-data column
    if (elementDef.type === 'table' && (actionResult as any)._columnCount !== undefined) {
        const groupId = elementDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        const columnCount = (actionResult as any)._columnCount;
        return [
            {
                id: elementDef.id,
                originalId: elementDef.id,
                name: elementDef.name,
                type: 'json',
                elementId: elementDef.id,
                elementName: elementDef.name,
                group: { id: groupId, name: elementDef.name },
                isKeyValue: columnCount === 2,
                columnCount
            },
            {
                id: elementDef.id + '__tabledata',
                originalId: elementDef.id + '__tabledata',
                name: elementDef.name + ' (raw)',
                type: 'tabledata',
                hidden: true,
                elementId: elementDef.id,
                elementName: elementDef.name
            }
        ];
    }

    const isListOrSmart = elementDef.type === 'list' || elementDef.type === 'smart';

    if (actionResult.columns) {
        const cols = actionResult.columns;
        const groupId = elementDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        const isKeyValue = isListOrSmart && cols.length === 2;

        return cols.map(col => ({
            ...col,
            elementId: elementDef.id,
            elementName: elementDef.name,
            ...(isListOrSmart ? {
                group: { id: groupId, name: elementDef.name },
                name: `${elementDef.name} - ${col.name}`,
                ...(isKeyValue ? { isKeyValue: true } : {})
            } : {})
        }));
    }

    return [{
        id: elementDef.id,
        originalId: elementDef.id,
        name: elementDef.name,
        type: elementDef.type || 'text',
        elementId: elementDef.id,
        elementName: elementDef.name
    }];
}

/**
 * Shared between ElementProcessor and BackgroundElementProcessor — byte-for-byte identical
 * in both before this extraction. Collapses table rows into a compact JSON string for the
 * visible column (the raw row/column data is kept separately in the hidden `__tabledata` column).
 */
export function collapseTableToJson(items: any[], columns: any[]): string {
    const cols = columns || [];
    if (cols.length === 0 || items.length === 0) return '[]';

    const rowValues = items.map(row =>
        cols.map(col => row[col.id]).filter(v => v != null && String(v).trim() !== '')
    );

    if (cols.length === 1) {
        return JSON.stringify(rowValues.flat());
    }

    return JSON.stringify(rowValues.filter(vals => vals.length > 0));
}
