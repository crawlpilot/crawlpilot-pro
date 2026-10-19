/**
 * The Page assistant's brief (docs/plans/summarize-ask-plan.md P1): the page as AI Extract's view
 * (markdown with block refs), its kind, a brief per chunk through the on-device model, merged, and
 * every quoted point checked against the page.
 *
 * The page is reached through `AssistantPage`, so tests drive the same run with a fake page and model.
 */
import { modelHost, CALL_ERROR_MESSAGES, type CallError, type CallResult } from './modelHost';
import { relax } from '../../../shared/ai/constraint';
import { BRIEFS, BRIEF_SYSTEM, briefColumns, briefPrompt, briefRow, briefSchema, detectKind, mergeBriefs, parseBrief, type AnswerTable, type Brief, type PageKind } from '../../../shared/ai/brief';
import type { ClaimRequest, ClaimResult } from '../../../shared/ai/cite';
import type { PageView } from '../../../shared/ai/page';
import { sendToPage } from '../../../shared/messages';

export interface AssistantPage {
    view(chunkChars: number, maxChunks: number): Promise<PageView>;
    check(claims: ClaimRequest[]): Promise<ClaimResult[]>;
    show(ref: string, quote?: string): Promise<boolean>;
}

/** The page in one tab: the brief, its checks and "show on page" all go to that tab. */
export function tabPage(tabId: number): AssistantPage {
    const tab = () => chrome.tabs.get(tabId);
    return {
        view: async (chunkChars, maxChunks) => (await sendToPage(await tab(), 'AI_PAGE_VIEW', { chunkChars, maxChunks })).view,
        check: async claims => (await sendToPage(await tab(), 'AI_CHECK', { claims })).results,
        show: async (ref, quote) => {
            const t = await tab();
            // To the page's tab, brought to the front, then the block.
            await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
            if (t.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true }).catch(() => undefined);
            return (await sendToPage(t, 'AI_SHOW', { ref, ...(quote ? { quote } : {}) })).shown;
        },
    };
}

export interface BriefOutcome {
    view: PageView;
    kind: PageKind;
    brief: Brief;
    /** By point: `${section}.${index}`. Inferred points aren't checked. */
    checks: Record<string, ClaimResult>;
    /** The page was longer than the parts read. */
    partial: boolean;
}

export class AssistantError extends Error {
    constructor(readonly code: CallError, detail?: string) {
        super(code === 'model_unavailable' && detail ? detail : CALL_ERROR_MESSAGES[code]);
    }
}

/** Parts of a long page briefed: more costs a model call each. */
export const MAX_BRIEF_CHUNKS = 3;
/** Tokens a point's answer takes ({text, quote, ref}). */
const POINT_TOKENS = 70;
const reserveFor = (kind: PageKind) => 150 + BRIEFS[kind].fields.reduce((n, f) => n + f.max * POINT_TOKENS, 0);
/** The largest reserve (the kind isn't known before the page is read). */
const MAX_RESERVE = Math.max(...(Object.keys(BRIEFS) as PageKind[]).map(reserveFor));
/** The schema and the prompt's own words. */
const PROMPT_TOKENS = 450;
const MIN_CHUNK_CHARS = 1500;

export const pointKey = (section: string, i: number) => `${section}.${i}`;

/** One brief call, its constraint relaxed a step at a time if Chrome can't enforce it. */
async function briefCall(kind: PageKind, chunk: string, title: string, signal?: AbortSignal): Promise<CallResult<Brief>> {
    let schema: Record<string, unknown> = briefSchema(kind);
    const call = (s: Record<string, unknown>, text: string) => modelHost.run({
        system: BRIEF_SYSTEM, sampling: 'exact', prompt: briefPrompt(kind, text, title), schema: s, reserve: reserveFor(kind),
        parse: raw => parseBrief(raw, kind), timeoutMs: 90_000,
    }, signal);
    let res = await call(schema, chunk);
    for (let step = 0; !res.ok && (res.code === 'schema_unsupported' || res.code === 'unsatisfiable'); step++) {
        const next = relax(schema, step);
        if (!next) break;
        schema = next;
        res = await call(schema, chunk);
    }
    // Measured too large after all: the first part of the chunk.
    if (!res.ok && res.code === 'too_large') res = await call(schema, chunk.slice(0, Math.floor(chunk.length * 0.6)));
    return res;
}

export interface BriefRunOptions {
    page: AssistantPage;
    onStatus?: (status: { step: 'reading' | 'briefing' | 'checking'; part?: number; parts?: number; kind?: PageKind }) => void;
    signal?: AbortSignal;
}

export async function runBrief({ page, onStatus, signal }: BriefRunOptions): Promise<BriefOutcome> {
    onStatus?.({ step: 'reading' });
    const room = await modelHost.room(BRIEF_SYSTEM, 'exact', 'The quick brown fox jumps over the lazy dog. '.repeat(40), MAX_RESERVE);
    if ('code' in room) throw new AssistantError(room.code);
    const chunkChars = Math.max(MIN_CHUNK_CHARS, Math.floor((room.tokens - PROMPT_TOKENS) * room.charsPerToken * 0.9));
    const view = await page.view(chunkChars, MAX_BRIEF_CHUNKS);
    const kind = detectKind(view);
    const chunks = view.chunks.filter(c => c.trim().length > 0);
    if (chunks.length === 0) throw new AssistantError('failed', 'The page has no text to brief.');

    const parts: Brief[] = [];
    for (let i = 0; i < chunks.length; i++) {
        onStatus?.({ step: 'briefing', part: i + 1, parts: chunks.length, kind });
        const res = await briefCall(kind, chunks[i], view.title, signal);
        if (res.ok) { parts.push(res.value); continue; }
        if (res.code === 'aborted' || res.code === 'model_unavailable' || res.code === 'session_lost' || res.code === 'needs_activation') throw new AssistantError(res.code, res.detail);
        // A part that fails (invalid output, too large): the brief comes from the others.
        if (i === chunks.length - 1 && parts.length === 0) throw new AssistantError(res.code, res.detail);
    }
    const brief = mergeBriefs(parts);

    onStatus?.({ step: 'checking', kind });
    const claims: ClaimRequest[] = [];
    for (const s of brief.sections) {
        if (s.inferred) continue;
        s.points.forEach((p, i) => claims.push({ key: pointKey(s.key, i), text: p.text, quote: p.quote, refs: p.ref ? [p.ref] : [] }));
    }
    const results = claims.length > 0 ? await page.check(claims) : [];
    return { view, kind, brief, checks: Object.fromEntries(results.map(r => [r.key, r])), partial: view.truncated };
}

/** The brief as Markdown (copying): sections, points, and where each is on the page. */
export function briefMarkdown(outcome: BriefOutcome): string {
    const lines = [`# ${outcome.view.title || outcome.view.url}`, '', `${BRIEFS[outcome.kind].label} · ${outcome.view.url}`, ''];
    for (const s of outcome.brief.sections) {
        if (s.points.length === 0) continue;
        lines.push(`## ${s.label}${s.inferred ? ' (the model\'s reading)' : ''}`);
        s.points.forEach((p, i) => {
            const check = outcome.checks[pointKey(s.key, i)];
            const mark = s.inferred ? '' : check?.status === 'verified' || check?.status === 'relocated' ? ` — “${p.quote}”` : ' — (not found on the page)';
            lines.push(`- ${p.text}${mark}`);
        });
        lines.push('');
    }
    return lines.join('\n').trim() + '\n';
}

/** Share of the context the page takes in a conversation; the rest is the questions and answers. */
const ASK_DOC_SHARE = 0.55;

/** The page as the conversation's reference: as many of the view's chunks as fit, in order. */
export async function askReference(view: PageView, system: string): Promise<string | { code: CallError }> {
    const joined = view.chunks.join('\n');
    const room = await modelHost.room(system, 'default', joined);
    if ('code' in room) return room;
    const budget = Math.floor(room.tokens * room.charsPerToken * ASK_DOC_SHARE);
    let page = '';
    for (const c of view.chunks) {
        if (page.length + c.length > budget) break;
        page += (page ? '\n' : '') + c;
    }
    return page || view.chunks[0].slice(0, budget);
}

// ── Answers become data (docs/plans/summarize-ask-plan.md A3) ──

const BRIEFS_TABLE = 'Briefs';
const BRIEFS_SOURCE = 'brief';

/** Adds the brief to the one "Briefs" table (made on first use). Returns the table's id. */
export async function saveBrief(outcome: BriefOutcome): Promise<number> {
    const { db } = await import('../../../shared/db');
    const found = (status?: string) => status === 'verified' || status === 'relocated';
    const row = briefRow(outcome.brief, { url: outcome.view.url, title: outcome.view.title }, (section, i) => found(outcome.checks[pointKey(section, i)]?.status));
    const existing = (await db.tables.list(200)).find(t => t.source === BRIEFS_SOURCE && !t.preview);
    const id = existing?.id ?? await db.tables.create({
        name: BRIEFS_TABLE, source: BRIEFS_SOURCE, sourceUrl: outcome.view.url, columns: [], rowCount: 0, preview: false, view: {},
    });
    await db.tables.appendRows(id, [row]);
    await db.tables.setColumns(id, briefColumns());
    return id;
}

/** An answer's table as a dataset in My data. Returns its id. */
export async function saveTable(table: AnswerTable, name: string, url: string): Promise<number> {
    const { db } = await import('../../../shared/db');
    const ids = table.columns.map((c, i) => c.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || `column_${i + 1}`)
        .map((id, i, all) => (all.indexOf(id) === i ? id : `${id}_${i + 1}`));
    return db.tables.save({
        type: 'ai-assistant',
        source_url: url,
        columns: [...table.columns.map((name, i) => ({ id: ids[i], name, type: 'text' as const })), { id: 'source_url', name: 'URL', type: 'url' as const }],
        items: table.rows.map(r => ({ ...Object.fromEntries(ids.map((id, i) => [id, r.cells[i]])), source_url: url })),
    }, { name });
}

/** Opens a dataset in the data table (its own tab). */
export function openTable(id: number) {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${id}`) });
}
