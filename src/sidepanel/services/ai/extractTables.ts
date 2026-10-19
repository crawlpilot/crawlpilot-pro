/**
 * An AI Extract outcome as tables for the data viewer: each list becomes a table (the page's single
 * answers added to every row); a schema with no lists becomes one row. Values are typed (numbers stay
 * numbers, so exports keep the schema's types). Each row keeps `_sources`: per field, its status, tier
 * and where it came from (hidden from the columns, outside the row's identity).
 */
import type { Column, ColumnType, ExtractionResult } from '../../../shared/types/database';
import type { IntakeResult, SchemaField, SchemaList } from '../../../shared/ai/schemaIntake';
import { assemble, sourcesByPointer, validate, type Problem } from '../../../shared/ai/assemble';
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

const columns = (fields: SchemaField[]): Column[] => fields.map((f, order) => ({ id: f.name, name: f.label || f.name, type: columnType(f), order }));
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

/** A value as the assembler takes it: several values from their page text, the rest typed. */
const raw = (f: SchemaField, v: ExtractedValue | undefined) => (v && v.status !== 'empty' && v.status !== 'needs_model' ? (f.many ? v.text : v.value) : null);
const rawValues = (fields: SchemaField[], values: Record<string, ExtractedValue>) => Object.fromEntries(fields.map(f => [f.name, raw(f, values[f.name])]));

/** The outcome in the schema's own shape: nested objects, arrays of values, lists of objects. */
export function outcomeJson(outcome: ExtractOutcome, intake: Pick<IntakeResult, 'fields' | 'lists' | 'plan'>): unknown {
    if (intake.plan) {
        return assemble(intake.plan, {
            single: rawValues(intake.fields, outcome.single),
            lists: Object.fromEntries(intake.lists.map(l => [l.name, (outcome.lists[l.name] ?? []).map(item => rawValues(l.fields, item))])),
        });
    }
    const out: Record<string, unknown> = {};
    for (const f of intake.fields) out[f.name] = cell(outcome.single[f.name]);
    for (const l of intake.lists) out[l.name] = (outcome.lists[l.name] ?? []).map(item => Object.fromEntries(l.fields.map(f => [f.name, cell(item[f.name])])));
    return out;
}

export interface OutcomeDocument {
    url: string;
    /** In the schema's shape. */
    data: unknown;
    /** Per JSON pointer of a value in `data`: its status, tier and where it came from. */
    sources: Record<string, ReturnType<typeof source>>;
    /** Where `data` doesn't meet the schema (a required value not found, a value not in the enum). */
    problems: Problem[];
    warnings: string[];
}

/** The whole result as thenos returns an extraction: data in shape, sources by pointer, problems, warnings. */
export function outcomeDocument(outcome: ExtractOutcome, intake: Pick<IntakeResult, 'fields' | 'lists' | 'plan' | 'schema'>): OutcomeDocument {
    const data = outcomeJson(outcome, intake);
    const meta = (values: Record<string, ExtractedValue>) => Object.fromEntries(Object.entries(values).filter(([, v]) => v.status !== 'empty' && v.status !== 'needs_model').map(([k, v]) => [k, source(v)]));
    const sources = intake.plan
        ? sourcesByPointer(intake.plan, meta(outcome.single), Object.fromEntries(intake.lists.map(l => [l.name, (outcome.lists[l.name] ?? []).map(meta)])))
        : {};
    return { url: outcome.url, data, sources, problems: intake.schema ? validate(data, intake.schema) : [], warnings: outcome.warnings };
}
