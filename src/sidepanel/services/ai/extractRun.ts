/**
 * AI Extract on one page (docs/plans/ai-extract-markdown-plan.md §3.2): a schema in, the page's values
 * out, each with where it came from and whether the page really says it.
 *
 * 1. **T0, structured data** (`shared/ai/structured.ts`): JSON-LD, microdata and meta answer what they
 *    can, with no model.
 * 2. **T2, the on-device model** (through `modelHost`) for what is left, every call sized to the
 *    measured window (`budget.ts`, docs/plans/ai-extract-v2-plan.md §3.2):
 *    - single answers: in groups of at most 8 fields, each over the whole page when it fits, else over
 *      the blocks most about that group's fields; one targeted retry for required fields still empty;
 *    - lists: one call per chunk, items per chunk from the item's width; a wide item is read in passes
 *      (its identifying fields + up to 8 others each), joined on the identifying fields;
 *    - at most 40 calls per page; reaching it is a warning.
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
import { chunkMarkdown } from '../../../shared/markdown/chunks';
import {
    groupFields, identityFields, inputChars, itemsPerChunk, listPasses, listReserve, singleReserve,
    MAX_CALLS, MAX_LIST_CHUNKS,
} from './budget';
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

/** The page is read once, whole (up to this much); calls cut it to their own size. */
const VIEW_CHARS = 400_000;

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

    opts.onStatus?.('Opening hidden sections and reading the page…');
    const view = await page.view(VIEW_CHARS, 1);
    if (!view.chunks.length) throw new Error('No readable text found on this page.');
    if (view.truncated) warnings.push('The page is very long: only its first part was read.');
    const markdown = view.chunks.join('\n\n');
    stopped();

    // Characters per token measured on this page's own text (a Japanese page is not an English one).
    let room = { tokens: 0, charsPerToken: 4 };
    if (model) {
        const r = await modelHost.room(EXTRACT_SYSTEM_PROMPT, 'exact', markdown.slice(0, 4000), 0);
        if ('code' in r) throw new Error(message(r.code));
        room = r;
    }
    /** Page characters a call can take, after its answer, its own text and its constraint. */
    const sizeFor = (reserve: number, prompt: string, schema: Record<string, unknown>) =>
        inputChars(room, reserve, prompt.length, JSON.stringify(compileConstraint(schema)).length);

    const single: Record<string, ExtractedValue> = {};
    const lists: Record<string, ExtractedItem[]> = {};
    let modelUsed = false;
    let calls = 0;
    let capped = false;
    const budgetLeft = () => {
        if (calls < MAX_CALLS) return true;
        if (!capped) { capped = true; warnings.push(`Stopped after ${MAX_CALLS} model calls on this page: some fields or items were not read.`); }
        return false;
    };

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
        calls++;
        let res = await modelHost.run({ system: EXTRACT_SYSTEM_PROMPT, sampling: 'exact', prompt, schema: constraint, reserve, parse }, opts.signal);
        // A constraint Chrome can't enforce, or can't satisfy: relaxed a step at a time, never dropped.
        for (let step = 0; !res.ok && (res.code === 'schema_unsupported' || res.code === 'unsatisfiable'); step++) {
            const next = relax(constraint, step);
            if (!next) break;
            constraint = next;
            calls++;
            res = await modelHost.run({ system: EXTRACT_SYSTEM_PROMPT, sampling: 'exact', prompt, schema: constraint, reserve, parse }, opts.signal);
        }
        if (!res.ok && res.code === 'aborted') throw new ExtractStopped('Stopped.');
        if (!res.ok && (res.code === 'model_unavailable' || res.code === 'session_lost')) throw new Error(message(res.code, res.detail));
        return res;
    };

    // ── T2: single answers, a group of fields per call ──
    const missing = intake.fields.filter(f => !single[f.name]);
    const answers: Record<string, FieldAnswer> = {};
    let pageCut = false;
    if (missing.length && model) {
        const ask = async (fields: SchemaField[], narrow: boolean) => {
            if (!budgetLeft()) return;
            const terms = fields.map(f => `${f.label ?? f.name} ${f.description ?? ''}`).join(' ');
            const schema = buildResponseSchema(fields);
            const reserve = singleReserve(fields);
            let size = sizeFor(reserve, buildExtractPrompt('', fields, opts.instructions), schema);
            if (narrow) size = Math.floor(size * 0.6);
            for (let attempt = 0; attempt < 2; attempt++) {
                const fits = markdown.length <= size;
                if (!fits) pageCut = true;
                const text = fits ? markdown : selectBlocks([markdown], terms, size);
                const res = await run(buildExtractPrompt(text, fields, opts.instructions), schema, reserve, raw => parseModelOutput(raw, fields));
                if (res.ok) { modelUsed = true; Object.assign(answers, res.value); return; }
                // Too big after all (the estimate was off): the same fields over less of the page.
                if (res.code === 'too_large' && attempt === 0 && budgetLeft()) { size = Math.floor(size * 0.6); continue; }
                warnings.push(`${fields.map(f => f.label ?? f.name).join(', ')}: ${message(res.code, res.detail)}`);
                return;
            }
        };
        const groups = groupFields(missing);
        for (let g = 0; g < groups.length; g++) {
            stopped();
            opts.onStatus?.(groups.length > 1
                ? `Asking the model for fields, part ${g + 1} of ${groups.length}…`
                : `Asking the model for ${missing.length} field${missing.length !== 1 ? 's' : ''}…`);
            await ask(groups[g], false);
        }
        // One targeted retry for required fields still empty, over the blocks most about them.
        const retry = missing.filter(f => f.required && !answers[f.name]?.value);
        if (retry.length && pageCut) {
            opts.onStatus?.(`Looking again for ${retry.map(f => f.label ?? f.name).join(', ')}…`);
            for (const group of groupFields(retry)) await ask(group, true);
        }
    }

    // ── Lists: T0, else T2 pass by pass, chunk by chunk ──
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
        const passes = listPasses(list);
        const results: MergeItem[][] = [];
        for (let p = 0; p < passes.length; p++) {
            const pass = passes[p];
            const max = itemsPerChunk(pass.fields);
            const schema = buildListSchema(pass, max);
            const reserve = listReserve(pass.fields);
            const size = sizeFor(reserve, buildListPrompt('', pass, max, opts.instructions), schema);
            let chunks = chunkMarkdown(markdown, size);
            if (chunks.length > MAX_LIST_CHUNKS) {
                warnings.push(`${list.name}: only the first ${MAX_LIST_CHUNKS} parts of the page were read for this list.`);
                chunks = chunks.slice(0, MAX_LIST_CHUNKS);
            }
            const found: MergeItem[] = [];
            let continued = 0;
            for (let i = 0; i < chunks.length; i++) {
                stopped();
                if (!budgetLeft()) break;
                const part = passes.length > 1 ? ` (fields ${p + 1} of ${passes.length})` : '';
                opts.onStatus?.(`Reading ${list.name}${part}: part ${i + 1} of ${chunks.length}…`);
                const res = await run<ItemAnswer[]>(buildListPrompt(chunks[i], pass, max, opts.instructions), schema, reserve, raw => parseListOutput(raw, pass));
                if (!res.ok) { warnings.push(`${list.name}, part ${i + 1}: ${message(res.code, res.detail)}`); continue; }
                modelUsed = true;
                found.push(...res.value.map(it => ({ values: it.values, ref: it.ref, chunk: i })));
                // A full answer may have left items out: read the rest of this part, after the last item given.
                const rest = res.value.length >= max ? after(chunks[i], res.value[res.value.length - 1].ref) : '';
                if (rest && continued < MAX_LIST_CHUNKS) { chunks.splice(i + 1, 0, rest); continued++; }
            }
            results.push(mergeItems(found));
        }
        listAnswers[list.name] = joinPasses(results, identityFields(list.fields).map(f => f.name));
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

/** The part of `chunk` after the block `ref` (the next line on), or '' when little is left. */
function after(chunk: string, ref: string): string {
    if (!ref) return '';
    const at = chunk.indexOf(`[${ref}]`);
    if (at < 0) return '';
    const line = chunk.indexOf('\n', at);
    const rest = line < 0 ? '' : chunk.slice(line + 1).trim();
    return rest.length > 200 ? rest : '';
}

const key = (v: string) => v.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A wide list's passes into one list of items: each later pass's items join the first pass's item with
 * the same identifying values (or, without any, the same ref); an item no earlier pass had is added.
 */
export function joinPasses(passes: MergeItem[][], ids: string[]): MergeItem[] {
    const [first = [], ...rest] = passes;
    const out = first.map(item => ({ ...item, values: { ...item.values } }));
    const identity = (item: MergeItem) => {
        const parts = ids.map(id => key(item.values[id] ?? '')).filter(Boolean);
        return parts.length ? parts.join('\u0000') : null;
    };
    for (const pass of rest) {
        for (const item of pass) {
            const id = identity(item);
            const match = out.find(o => (id !== null && identity(o) === id) || (id === null && item.ref && o.ref === item.ref));
            if (match) { for (const [k, v] of Object.entries(item.values)) if (v && !match.values[k]) match.values[k] = v; }
            else out.push({ ...item, values: { ...item.values } });
        }
    }
    return out;
}

export { ExtractStopped };
