/**
 * AI Extract on one page (docs/plans/ai-extract-markdown-plan.md §3.2): a schema in, the page's values
 * out, each with where it came from and whether the page really says it.
 *
 * 1. **T0, structured data** (`shared/ai/structured.ts`): JSON-LD, microdata and meta answer what they
 *    can, with no model.
 * 2. **T2, the on-device model** (through `modelHost`) for what is left:
 *    - single answers: one call over the page, or over the blocks most about the fields when the page
 *      doesn't fit; one targeted retry for required fields still empty;
 *    - lists: one call per chunk of the page, items merged across chunks.
 * 3. **Grounding** (content script): every model answer is checked against the block it cites, its
 *    item's blocks, or the whole page. A value the page doesn't contain is `unverified` and never
 *    shown as verified.
 * 4. **Types**: numbers, booleans and URLs are parsed; a value that won't parse is `invalid`.
 *
 * With the model unavailable, T0 still runs and the rest is reported as needing the model. The page is
 * reached through `PageAccess`, so tests drive the same pipeline in jsdom.
 */
import { modelHost, modelStatus, CALL_ERROR_MESSAGES, type CallError, type CallResult } from './modelHost';
import {
    buildExtractPrompt, buildListPrompt, buildListSchema, buildResponseSchema, EXTRACT_SYSTEM_PROMPT,
    parseListOutput, parseModelOutput, type FieldAnswer, type ItemAnswer,
} from '../../../shared/ai/extractPrompt';
import { compileConstraint, relax } from '../../../shared/ai/constraint';
import { structuredAnswers, structuredList } from '../../../shared/ai/structured';
import { mergeItems, selectBlocks, type MergeItem } from '../../../shared/ai/merge';
import { cleanUrl, parseBoolean, parseNumber } from '../../../shared/transforms/parsers';
import type { SchemaField, SchemaList } from '../../../shared/ai/schemaIntake';
import type { GroundRequest, Grounded, PageView } from '../../../shared/ai/page';
import type { GradedSelector } from '../../../shared/selectors/grade';
import { sendToActiveTab } from '../../../shared/messages';
import type { RevealReport } from '../../../shared/types/reveal';

export interface PageAccess {
    view(chunkChars: number, maxChunks: number): Promise<PageView>;
    ground(requests: GroundRequest[]): Promise<Grounded[]>;
}

export const activeTabPage: PageAccess = {
    view: async (chunkChars, maxChunks) => (await sendToActiveTab('AI_PAGE_VIEW', { chunkChars, maxChunks })).view,
    ground: async requests => (await sendToActiveTab('AI_GROUND', { requests })).results,
};

export type ValueStatus = 'structured' | 'verified' | 'relocated' | 'unverified' | 'empty' | 'invalid' | 'needs_model';

export interface ExtractedValue {
    /** Typed: a number, a boolean, a URL, or the text. */
    value: unknown;
    /** As the page (or the structured data) has it. */
    text: string;
    status: ValueStatus;
    tier: 't0' | 't2';
    /** `Product.offers.price`, `meta og:title`, or the block ref `b12`. */
    source?: string;
    /** Single fields compiled for the Page Extractor. */
    selectors?: string[];
    elementType?: Grounded['type'];
    grade?: GradedSelector;
}

export type ExtractedItem = Record<string, ExtractedValue>;

export interface ExtractOutcome {
    url: string;
    title: string;
    single: Record<string, ExtractedValue>;
    lists: Record<string, ExtractedItem[]>;
    warnings: string[];
    /** The model was used for at least one value. */
    modelUsed: boolean;
    /** Hidden sections opened or read before the page was read. */
    revealed?: RevealReport;
}

export interface ExtractOptions {
    page?: PageAccess;
    /** Extra instructions from the user ("prices in USD"). */
    instructions?: string;
    /** Compile single fields to selectors (the Page Extractor's AI dialog). */
    compileSingle?: boolean;
    onStatus?: (s: string) => void;
    onDownloadProgress?: (f: number) => void;
    signal?: AbortSignal;
}

const MAX_CHUNKS = 8;
const MAX_LIST_CHUNKS = 6;
const ITEMS_PER_CHUNK = 20;
/** Tokens a list item's answer takes, per field. */
const ITEM_FIELD_TOKENS = 14;
const NO_MODEL_CHUNK_CHARS = 12_000;

const reserveSingle = (fields: SchemaField[]) => 200 + fields.length * 40;
const reserveList = (list: SchemaList) => 100 + ITEMS_PER_CHUNK * (8 + list.fields.length * ITEM_FIELD_TOKENS);

class ExtractStopped extends Error {}

function message(code: CallError, detail?: string): string {
    return code === 'model_unavailable' && detail ? detail : CALL_ERROR_MESSAGES[code];
}

/** Parses a value to the field's type; `undefined` when it won't parse. */
function typed(field: SchemaField, text: string, pageUrl: string): unknown {
    switch (field.type) {
        case 'number': return parseNumber(text);
        case 'integer': { const n = parseNumber(text); return n === undefined ? undefined : Math.round(n); }
        case 'boolean': return parseBoolean(text);
        case 'url': case 'image': return cleanUrl(text, pageUrl);
        default: return text;
    }
}

function finish(field: SchemaField, text: string, status: ValueStatus, tier: 't0' | 't2', pageUrl: string, extra: Partial<ExtractedValue> = {}): ExtractedValue {
    if (!text) return { value: null, text: '', status: status === 'needs_model' ? status : 'empty', tier, ...extra };
    const value = typed(field, text, pageUrl);
    return { value: value ?? text, text, status: value === undefined ? 'invalid' : status, tier, ...extra };
}

const groundStatus: Record<Grounded['status'], ValueStatus> = { verified: 'verified', relocated: 'relocated', not_on_page: 'unverified', empty: 'empty' };

export async function runPageExtract(intake: { fields: SchemaField[]; lists: SchemaList[] }, opts: ExtractOptions = {}): Promise<ExtractOutcome> {
    const page = opts.page ?? activeTabPage;
    const warnings: string[] = [];
    const stopped = () => { if (opts.signal?.aborted) throw new ExtractStopped('Stopped.'); };

    // The model, if there is one: T0 runs either way.
    opts.onStatus?.('Starting the on-device model…');
    let model = (await modelStatus()).availability !== 'unavailable';
    if (model) {
        const ready = await modelHost.prepare(EXTRACT_SYSTEM_PROMPT, 'exact', opts.onDownloadProgress);
        if (!ready.ok) {
            if (ready.code === 'aborted') throw new ExtractStopped('Stopped.');
            model = false;
            warnings.push(message(ready.code, ready.detail));
        }
    } else warnings.push(message('model_unavailable', (await modelStatus()).reason));
    stopped();

    // Chunk size from the room a call has (the larger of the two kinds of call this run makes).
    let chunkChars = NO_MODEL_CHUNK_CHARS;
    if (model) {
        const reserve = Math.max(intake.fields.length ? reserveSingle(intake.fields) : 0, ...intake.lists.map(reserveList));
        const room = await modelHost.room(EXTRACT_SYSTEM_PROMPT, 'exact', 'The quick brown fox jumps over the lazy dog. '.repeat(40), reserve);
        if ('code' in room) throw new Error(message(room.code));
        chunkChars = Math.max(1500, Math.floor(room.tokens * room.charsPerToken * 0.8) - 800);
    }

    opts.onStatus?.('Opening hidden sections and reading the page…');
    const view = await page.view(chunkChars, MAX_CHUNKS);
    if (!view.chunks.length) throw new Error('No readable text found on this page.');
    if (view.truncated) warnings.push(`The page is long: only its first ${view.chunks.length} parts were read.`);
    stopped();

    const single: Record<string, ExtractedValue> = {};
    const lists: Record<string, ExtractedItem[]> = {};
    let modelUsed = false;

    // ── T0: structured data ──
    const t0 = structuredAnswers(intake.fields, view.structured);
    const groundT0: GroundRequest[] = [];
    for (const f of intake.fields) {
        const hit = t0[f.name];
        if (!hit) continue;
        single[f.name] = finish(f, hit.value, 'structured', 't0', view.url, { source: hit.source });
        if (opts.compileSingle) groundT0.push({ key: f.name, value: hit.value, type: f.type, compile: true });
    }

    const run = async <T>(prompt: string, schema: Record<string, unknown>, reserve: number, parse: (raw: string) => T): Promise<CallResult<T>> => {
        let constraint = compileConstraint(schema);
        let res = await modelHost.run({ system: EXTRACT_SYSTEM_PROMPT, sampling: 'exact', prompt, schema: constraint, reserve, parse }, opts.signal);
        // A constraint Chrome can't enforce, or can't satisfy: relaxed a step at a time, never dropped.
        for (let step = 0; !res.ok && (res.code === 'schema_unsupported' || res.code === 'unsatisfiable'); step++) {
            const next = relax(constraint, step);
            if (!next) break;
            constraint = next;
            res = await modelHost.run({ system: EXTRACT_SYSTEM_PROMPT, sampling: 'exact', prompt, schema: constraint, reserve, parse }, opts.signal);
        }
        if (!res.ok && res.code === 'aborted') throw new ExtractStopped('Stopped.');
        if (!res.ok && (res.code === 'model_unavailable' || res.code === 'session_lost')) throw new Error(message(res.code, res.detail));
        return res;
    };

    // ── T2: single answers ──
    const missing = intake.fields.filter(f => !single[f.name]);
    const answers: Record<string, FieldAnswer> = {};
    if (missing.length && model) {
        const ask = async (fields: SchemaField[]) => {
            const terms = fields.map(f => `${f.name} ${f.description ?? ''}`).join(' ');
            let text = view.chunks.length === 1 ? view.chunks[0] : selectBlocks(view.chunks, terms, chunkChars);
            for (let attempt = 0; attempt < 2; attempt++) {
                const res = await run(buildExtractPrompt(text, fields, opts.instructions), buildResponseSchema(fields), reserveSingle(fields), raw => parseModelOutput(raw, fields));
                if (res.ok) { modelUsed = true; Object.assign(answers, res.value); return; }
                if (res.code === 'too_large' && attempt === 0) { text = selectBlocks(view.chunks, terms, Math.floor(chunkChars * 0.6)); continue; }
                warnings.push(`${fields.map(f => f.name).join(', ')}: ${message(res.code, res.detail)}`);
                return;
            }
        };
        opts.onStatus?.(`Asking the model for ${missing.length} field${missing.length !== 1 ? 's' : ''}…`);
        await ask(missing);
        // One targeted retry for required fields still empty, over the blocks most about them.
        const retry = missing.filter(f => f.required && !answers[f.name]?.value);
        if (retry.length && view.chunks.length > 1) {
            opts.onStatus?.(`Looking again for ${retry.map(f => f.name).join(', ')}…`);
            await ask(retry);
        }
    }

    // ── Lists: T0, else T2 chunk by chunk ──
    const listAnswers: Record<string, MergeItem[]> = {};
    for (const list of intake.lists) {
        const fromData = structuredList(list, view.structured);
        if (fromData.length) {
            lists[list.name] = fromData.map(hits => Object.fromEntries(list.fields.map(f => [f.name, hits[f.name]
                ? finish(f, hits[f.name].value, 'structured', 't0', view.url, { source: hits[f.name].source })
                : finish(f, '', 'empty', 't0', view.url)])));
            continue;
        }
        if (!model) { lists[list.name] = []; warnings.push(`${list.name}: needs the on-device model (no structured data lists them).`); continue; }
        const found: MergeItem[] = [];
        const chunks = view.chunks.slice(0, MAX_LIST_CHUNKS);
        if (view.chunks.length > MAX_LIST_CHUNKS) warnings.push(`${list.name}: only the first ${MAX_LIST_CHUNKS} parts of the page were read for this list.`);
        for (let i = 0; i < chunks.length; i++) {
            stopped();
            opts.onStatus?.(`Reading ${list.name}: part ${i + 1} of ${chunks.length}…`);
            const res = await run<ItemAnswer[]>(buildListPrompt(chunks[i], list, ITEMS_PER_CHUNK, opts.instructions), buildListSchema(list, ITEMS_PER_CHUNK), reserveList(list), raw => parseListOutput(raw, list));
            if (!res.ok) { warnings.push(`${list.name}, part ${i + 1}: ${message(res.code, res.detail)}`); continue; }
            modelUsed = true;
            found.push(...res.value.map(it => ({ values: it.values, ref: it.ref, chunk: i })));
        }
        listAnswers[list.name] = mergeItems(found);
    }

    // ── Grounding ──
    opts.onStatus?.('Checking every value against the page…');
    const requests: GroundRequest[] = [...groundT0];
    for (const f of missing) {
        const a = answers[f.name];
        if (a?.value) requests.push({ key: f.name, value: a.value, ref: a.ref || undefined, type: f.type, compile: opts.compileSingle });
    }
    for (const list of intake.lists) {
        const items = listAnswers[list.name] ?? [];
        items.forEach((item, i) => {
            const next = items[i + 1]?.ref || undefined;
            for (const f of list.fields) {
                const v = item.values[f.name];
                if (v) requests.push({ key: `${list.name}\u0000${i}\u0000${f.name}`, value: v, ref: item.ref || undefined, within: item.ref ? [item.ref, next] : undefined, type: f.type });
            }
        });
    }
    const grounded = requests.length ? await page.ground(requests) : [];
    const byKey = new Map(grounded.map(g => [g.key, g]));
    stopped();

    for (const f of intake.fields) {
        const g = byKey.get(f.name);
        const compiled = g && opts.compileSingle ? { selectors: g.selectors, elementType: g.type, grade: g.grade } : {};
        if (single[f.name]) { Object.assign(single[f.name], compiled); continue; }
        const a = answers[f.name];
        if (!model) { single[f.name] = finish(f, '', 'needs_model', 't2', view.url); continue; }
        if (!a?.value || !g) { single[f.name] = finish(f, '', 'empty', 't2', view.url); continue; }
        // Links and images take the page's URL; text keeps what the model copied.
        const text = (f.type === 'url' || f.type === 'image') && g.pageValue ? g.pageValue : a.value;
        single[f.name] = finish(f, text, groundStatus[g.status], 't2', view.url, { source: a.ref || undefined, ...compiled });
    }
    for (const list of intake.lists) {
        if (lists[list.name]) continue;
        lists[list.name] = (listAnswers[list.name] ?? []).map((item, i) => Object.fromEntries(list.fields.map(f => {
            const v = item.values[f.name];
            const g = byKey.get(`${list.name}\u0000${i}\u0000${f.name}`);
            if (!v || !g) return [f.name, finish(f, '', 'empty', 't2', view.url)];
            const text = (f.type === 'url' || f.type === 'image') && g.pageValue ? g.pageValue : v;
            return [f.name, finish(f, text, groundStatus[g.status], 't2', view.url, { source: item.ref || undefined })];
        })));
    }

    const unverified = [...Object.values(single), ...Object.values(lists).flat().flatMap(i => Object.values(i))].filter(v => v.status === 'unverified').length;
    if (unverified) warnings.push(`${unverified} value${unverified !== 1 ? 's' : ''} the model gave ${unverified !== 1 ? 'are' : 'is'} not on the page: shown as unverified.`);
    for (const skip of view.revealed?.skipped.filter(s => s.reason !== 'outside the main content') ?? []) warnings.push(`Didn't click “${skip.label}”: ${skip.reason}.`);
    return { url: view.url, title: view.title, single, lists, warnings, modelUsed, ...(view.revealed ? { revealed: view.revealed } : {}) };
}

export { ExtractStopped };
