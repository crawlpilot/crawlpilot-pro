/**
 * An AI Extract outcome as tables for the data viewer: each list becomes a table (the page's single
 * answers added to every row); a schema with no lists becomes one row. Values are typed (numbers stay
 * numbers, so exports keep the schema's types). Each row keeps `_sources`: per field, its status, tier
 * and where it came from (hidden from the columns, outside the row's identity).
 */
import type { Column, ColumnType, ExtractionResult } from '../../../shared/types/database';
import type { SchemaField, SchemaList } from '../../../shared/ai/schemaIntake';
import type { ExtractOutcome, ExtractedValue } from './extractRun';

export const SOURCES_KEY = '_sources';

function columnType(f: SchemaField): ColumnType {
    switch (f.type) {
        case 'image': return 'image';
        case 'url': return 'url';
        case 'number': case 'integer': return 'number';
        default: return 'text';
    }
}

const columns = (fields: SchemaField[]): Column[] => fields.map((f, order) => ({ id: f.name, name: f.name, type: columnType(f), order }));
const cell = (v: ExtractedValue | undefined) => (v && v.status !== 'empty' && v.status !== 'needs_model' ? v.value : null);
const source = (v: ExtractedValue) => ({ status: v.status, tier: v.tier, ...(v.source ? { source: v.source } : {}) });

export function outcomeTables(outcome: ExtractOutcome, intake: { fields: SchemaField[]; lists: SchemaList[] }): { name: string; result: ExtractionResult }[] {
    const singleRow: Record<string, unknown> = {};
    const singleSources: Record<string, unknown> = {};
    for (const f of intake.fields) {
        const v = outcome.single[f.name];
        singleRow[f.name] = cell(v);
        if (v) singleSources[f.name] = source(v);
    }
    const page = outcome.title || outcome.url;
    const base = { source_url: outcome.url, type: 'ai-extract', timestamp: new Date().toISOString() };

    if (!intake.lists.length) {
        return [{ name: page, result: { ...base, columns: columns(intake.fields), items: [{ ...singleRow, source_url: outcome.url, [SOURCES_KEY]: singleSources }], count: 1 } }];
    }
    return intake.lists.map(list => {
        const items = (outcome.lists[list.name] ?? []).map(item => ({
            ...Object.fromEntries(list.fields.map(f => [f.name, cell(item[f.name])])),
            ...singleRow,
            source_url: outcome.url,
            [SOURCES_KEY]: { ...Object.fromEntries(list.fields.filter(f => item[f.name]).map(f => [f.name, source(item[f.name])])), ...singleSources },
        }));
        return { name: `${list.name} · ${page}`, result: { ...base, columns: columns([...list.fields, ...intake.fields]), items, count: items.length } };
    });
}

/** The outcome in the schema's own shape: single answers as keys, each list as an array of objects. */
export function outcomeJson(outcome: ExtractOutcome, intake: { fields: SchemaField[]; lists: SchemaList[] }): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of intake.fields) out[f.name] = cell(outcome.single[f.name]);
    for (const l of intake.lists) out[l.name] = (outcome.lists[l.name] ?? []).map(item => Object.fromEntries(l.fields.map(f => [f.name, cell(item[f.name])])));
    return out;
}
