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
import { checkClaims, type ClaimRequest, type ClaimResult } from '../../../shared/ai/cite';
import { detectLanguage, translateChunk, translationSupported, translatorFor } from './translate';
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
    /** The page's language when it was translated to English for the model (`view` holds the translation). */
    translatedFrom?: string;
    /** The translated blocks (`ref → text`): claims are checked against these, not the page. */
    blocks?: Map<string, string>;
    /** The language the brief is shown in, when not English. */
    shownIn?: string;
    /** The user's language, when its translation still needs a click to download. */
    showInPending?: string;
}

/** A language pack must be downloaded first, which needs a click. */
export class TranslationNeeded extends Error {
    constructor(readonly source: string, readonly target: string) {
        super(`The ${source} → ${target} translation needs downloading.`);
    }
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
    /** The user's language: the brief is translated into it when it isn't English. */
    userLang?: string;
    onStatus?: (status: { step: 'reading' | 'translating' | 'briefing' | 'checking'; part?: number; parts?: number; kind?: PageKind; language?: string }) => void;
    signal?: AbortSignal;
}

/** Blocks of a (translated) view: each line ending in a reference, as `ref → text`. */
export function viewBlockTexts(chunks: string[]): Map<string, string> {
    const blocks = new Map<string, string>();
    for (const line of chunks.join('\n').split('\n')) {
        const m = line.match(/^(.*?)\s*\[(b\d+)\]\s*$/);
        if (m) blocks.set(m[2], m[1].replace(/^[#>*\-\s|]+/, '').trim());
    }
    return blocks;
}

/** The page as the assistant checks it: a translated page's claims against its translated blocks. */
export function checkedPage(outcome: Pick<BriefOutcome, 'blocks'>, page: AssistantPage): AssistantPage {
    if (!outcome.blocks) return page;
    const blocks = outcome.blocks;
    return {
        view: page.view,
        check: async claims => checkClaims(claims, blocks),
        // The quote is in English, the page isn't: the block is shown whole.
        show: ref => page.show(ref),
    };
}

export async function runBrief({ page, userLang, onStatus, signal }: BriefRunOptions): Promise<BriefOutcome> {
    onStatus?.({ step: 'reading' });
    const room = await modelHost.room(BRIEF_SYSTEM, 'exact', 'The quick brown fox jumps over the lazy dog. '.repeat(40), MAX_RESERVE);
    if ('code' in room) throw new AssistantError(room.code);
    const chunkChars = Math.max(MIN_CHUNK_CHARS, Math.floor((room.tokens - PROMPT_TOKENS) * room.charsPerToken * 0.9));
    const original = await page.view(chunkChars, MAX_BRIEF_CHUNKS);
    const kind = detectKind(original);
    let chunks = original.chunks.filter(c => c.trim().length > 0);
    if (chunks.length === 0) throw new AssistantError('failed', 'The page has no text to brief.');

    // A page in another language: translated to English, line by line, refs kept.
    let translatedFrom: string | undefined;
    if (translationSupported()) {
        const lang = await detectLanguage(chunks[0].replace(/\s*\[b\d+\]/g, ''));
        if (lang && lang !== 'en') {
            const tr = await translatorFor(lang, 'en');
            if ('needs' in tr) throw new TranslationNeeded(lang, 'en');
            if ('translator' in tr) {
                const translated: string[] = [];
                for (let i = 0; i < chunks.length; i++) {
                    onStatus?.({ step: 'translating', part: i + 1, parts: chunks.length, kind, language: lang });
                    translated.push(await translateChunk(tr.translator, chunks[i]));
                }
                chunks = translated;
                translatedFrom = lang;
            }
        }
    }
    const view: PageView = translatedFrom ? { ...original, chunks } : original;
    const blocks = translatedFrom ? viewBlockTexts(chunks) : undefined;

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
    const results = claims.length > 0 ? await checkedPage({ blocks }, page).check(claims) : [];
    const outcome: BriefOutcome = { view, kind, brief, checks: Object.fromEntries(results.map(r => [r.key, r])), partial: view.truncated, ...(translatedFrom ? { translatedFrom, blocks } : {}) };

    // Shown in the user's language; a pack still to download waits for a click (`showBriefIn`).
    if (userLang && userLang !== 'en' && translationSupported()) {
        const tr = await translatorFor('en', userLang);
        if ('translator' in tr) return translateBrief(outcome, userLang, tr.translator);
        if ('needs' in tr) outcome.showInPending = userLang;
    }
    return outcome;
}

/** The brief's points in `lang` (quotes stay as the page has them: they are checked and shown). */
async function translateBrief(outcome: BriefOutcome, lang: string, translator: { translate(t: string): Promise<string> }): Promise<BriefOutcome> {
    const sections = [];
    for (const s of outcome.brief.sections) {
        const points = [];
        for (const p of s.points) points.push({ ...p, text: await translator.translate(p.text).catch(() => p.text) });
        sections.push({ ...s, points });
    }
    return { ...outcome, brief: { ...outcome.brief, sections }, shownIn: lang, showInPending: undefined };
}

/** From a click: downloads the user's language pack and shows the brief in it. */
export async function showBriefIn(outcome: BriefOutcome, lang: string, onProgress?: (f: number) => void): Promise<BriefOutcome> {
    const tr = await translatorFor('en', lang, onProgress);
    if (!('translator' in tr)) throw new Error(`Chrome can't translate into ${lang} on this device.`);
    return translateBrief(outcome, lang, tr.translator);
}

/** From a click: downloads a language pack (so the next run can translate). */
export async function downloadTranslation(source: string, target: string, onProgress?: (f: number) => void): Promise<boolean> {
    return 'translator' in (await translatorFor(source, target, onProgress));
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
