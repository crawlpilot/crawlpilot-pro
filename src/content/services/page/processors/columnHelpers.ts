import { ElementDefinition, ExtractionResult } from '../types';
import { slug } from '../../../../shared/utils/text';

/** The column definitions for one element's result, grouping list/smart/table columns under the element's name. */
export function extractColumns(elementDef: ElementDefinition, actionResult: ExtractionResult): any[] {
    // Table elements are JSON-consolidated: one visible JSON column + one hidden raw-data column
    if (elementDef.type === 'table' && (actionResult as any)._columnCount !== undefined) {
        const groupId = slug(elementDef.name, '_', '');
        const columnCount = (actionResult as any)._columnCount;
        return [
            {
                id: elementDef.id,
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
        const groupId = slug(elementDef.name, '_', '');
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
        name: elementDef.name,
        type: elementDef.type || 'text',
        elementId: elementDef.id,
        elementName: elementDef.name
    }];
}

/**
 * Collapses table rows into a compact JSON string for the
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

/** How a page's list elements land in the output. */
export type ListOutput = 'nested' | 'rows' | 'numbered';
export const NUMBERED_LIST_CAP = 10;

interface ListValue {
    __type: 'list';
    items: Record<string, unknown>[];
    columns: any[];
}

function isList(value: unknown): value is ListValue {
    return !!value && typeof value === 'object' && (value as any).__type === 'list';
}

/** A list field's key inside a nested record: its own name, without the "Element - " prefix. */
function fieldKey(col: any, elementName: string): string {
    const prefix = `${elementName} - `;
    return typeof col.name === 'string' && col.name.startsWith(prefix) ? col.name.slice(prefix.length) : col.name;
}

/**
 * Builds the output for one page: the element values keyed by element ID, plus each list element
 * shaped by `mode`. Every page gets the same columns whatever its list lengths:
 * - nested (default): one JSON column per list, an array of `{field: value}` objects;
 * - rows: one row per item of the first list, the page's other values repeated on each row;
 * - numbered: `Field 1 … Field N` columns, capped at NUMBERED_LIST_CAP items.
 */
export function buildPageRecord(data: Record<string, unknown>, knownColumns: any[], mode: ListOutput = 'nested'): { columns: any[]; item: any; items?: any[] } {
    const recordId = `rec_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const columns: any[] = [{ id: 'recordId', name: 'RECORD ID', type: 'text', elementId: 'recordId', elementName: 'Record Identifier' }];
    const row: Record<string, unknown> = { recordId };
    let driver: { key: string; value: ListValue } | null = null;

    for (const [key, value] of Object.entries(data)) {
        if (!isList(value)) {
            row[key] = value;
            const col = knownColumns.find(c => c.id === key);
            if (col) columns.push(col);
            continue;
        }
        const listCols = value.columns || [];
        const elementName: string = listCols[0]?.elementName ?? key;
        if (mode === 'rows' && !driver) {
            driver = { key, value };
            continue;
        }
        if (mode === 'numbered') {
            value.items.slice(0, NUMBERED_LIST_CAP).forEach((item, idx) => {
                listCols.forEach(col => {
                    const id = `${key}__${col.id}_${idx + 1}`;
                    row[id] = item[col.id] ?? null;
                    columns.push({ id, name: `${col.name} ${idx + 1}`, type: col.type || 'text', elementId: key, elementName });
                });
            });
            continue;
        }
        row[key] = JSON.stringify(value.items.map(item =>
            Object.fromEntries(listCols.filter(c => item[c.id] != null && item[c.id] !== '').map(c => [fieldKey(c, elementName), item[c.id]]))));
        columns.push({ id: key, name: elementName, type: 'json', elementId: key, elementName, listFields: listCols.map(c => fieldKey(c, elementName)) });
    }

    if (!driver) return { columns, item: row };

    const { key, value } = driver;
    value.columns.forEach(col => columns.push({ ...col, elementId: key }));
    const items = value.items.length === 0
        ? [row]
        : value.items.map((item, i) => ({
            ...row,
            recordId: `${row.recordId}_${i + 1}`,
            ...Object.fromEntries(value.columns.map(c => [c.id, item[c.id] ?? null])),
        }));
    return { columns, item: items[0], items };
}
