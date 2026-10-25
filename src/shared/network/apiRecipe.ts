/**
 * An API recipe (docs/plans/api-recipes-plan.md): a JSON call the API Finder recorded, turned into a
 * template that a run sends again from the site's own page (with the user's session), paging through
 * the results without rendering a page. The template marks the paging parameter (a page number, an
 * offset, a cursor the response hands back, or the response's link to the next page) and, optionally,
 * a query parameter filled with each value the user lists.
 */
import type { JsonPath, NetEntry } from './types';
import { exportableHeaders } from './requestSnippets';
import { resolvePath } from './jsonSearch';

export interface ApiRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
}

/** A parameter of the request: in the query string, or a value in its JSON body (`path` into it). */
export interface ApiParam {
    where: 'query' | 'body';
    name: string;
    /** Body only: the keys down to the value. */
    path?: string[];
    /** Its value in the recorded call. */
    value: string;
}

export type ApiPaging =
    | { mode: 'none' }
    /** A number that grows by `step` per page: a page number (step 1) or an offset (step = page size). */
    | { mode: 'number'; param: ApiParam; start: number; step: number }
    /** The response says where the next page starts (`next` in it); sent back in `param`. */
    | { mode: 'cursor'; param: ApiParam; next: JsonPath }
    /** The response holds the next page's URL. */
    | { mode: 'link'; next: JsonPath };

export interface ApiSpec {
    kind: 'api';
    request: ApiRequest;
    /** The page the call was recorded on: the run sends its calls from a tab at this page. */
    page: string;
    /** The list of items in the response (`data.products`). */
    items: JsonPath;
    paging: ApiPaging;
    /** Filled with each value the user lists (a search query, a category id); one series of pages per value. */
    input?: ApiParam;
    maxPages: number;
}

export const DEFAULT_MAX_PAGES = 50;

const OFFSET_NAME = /^(offset|start|skip|from|first_?result)$/i;
const CURSOR_NAME = /(cursor|after|before|token|continuation|next|last_?id|since_?id|scroll_?id)/i;
const PAGE_NAME = /^(page|p|pg|pagenum|page_?number|page_?no|pageindex|page_?index|currentpage|current_?page)$/i;
const SIZE_NAME = /^(limit|size|per_?page|page_?size|count|rows|num|take|hits_?per_?page|max_?results)$/i;
const NEXT_LINK_KEY = /^(next|next_?page|next_?url|next_?link|next_?page_?url|nextHref)$/i;
const NEXT_CURSOR_KEY = /^(end_?cursor|next_?cursor|cursor|next_?page_?token|next_?token|continuation(_?token)?|after|next|next_?page|scroll_?id|last_?id)$/i;
const TOTAL_PAGES_KEY = /^(total_?pages|page_?count|num_?pages|last_?page|pages)$/i;

// ---- Parameters ----

function bodyJson(req: ApiRequest): unknown {
    if (!req.body || !/^\s*[[{]/.test(req.body)) return undefined;
    try { return JSON.parse(req.body); } catch { return undefined; }
}

/** Every parameter a template could fill: query parameters, then the JSON body's plain values. */
export function requestParams(req: ApiRequest): ApiParam[] {
    const out: ApiParam[] = [];
    try {
        new URL(req.url).searchParams.forEach((value, name) => out.push({ where: 'query', name, value }));
    } catch { /* not a URL */ }
    const visit = (node: unknown, path: string[]) => {
        if (path.length > 4 || node === null || typeof node !== 'object' || Array.isArray(node)) return;
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
            if (v !== null && typeof v === 'object') visit(v, [...path, k]);
            else out.push({ where: 'body', name: k, path: [...path, k], value: v === null ? '' : String(v) });
        }
    };
    visit(bodyJson(req), []);
    return out;
}

export function sameParam(a: ApiParam | undefined, b: ApiParam | undefined): boolean {
    return !!a && !!b && a.where === b.where && a.name === b.name && (a.path ?? []).join('.') === (b.path ?? []).join('.');
}

/** The request with `param` set to `value` (a number stays a number in a JSON body). */
export function setParam(req: ApiRequest, param: ApiParam, value: string | number): ApiRequest {
    if (param.where === 'query') {
        const url = new URL(req.url);
        url.searchParams.set(param.name, String(value));
        return { ...req, url: url.href };
    }
    const body = bodyJson(req);
    if (!body || typeof body !== 'object') return req;
    const copy = JSON.parse(JSON.stringify(body));
    const path = param.path ?? [param.name];
    let node = copy;
    for (const k of path.slice(0, -1)) {
        if (node[k] === null || typeof node[k] !== 'object') node[k] = {};
        node = node[k];
    }
    const last = path[path.length - 1];
    node[last] = typeof value === 'number' || (typeof node[last] === 'number' && value !== '' && !isNaN(Number(value))) ? Number(value) : value;
    return { ...req, body: JSON.stringify(copy) };
}

export function paramValue(req: ApiRequest, param: ApiParam): string | undefined {
    if (param.where === 'query') {
        try { return new URL(req.url).searchParams.get(param.name) ?? undefined; } catch { return undefined; }
    }
    const v = resolvePath(bodyJson(req), param.path ?? [param.name])[0];
    return v === undefined || v === null ? undefined : String(v);
}

// ---- Reading the response ----

/** The items on one page of the response. */
export function itemsOf(json: unknown, items: JsonPath): unknown[] {
    const found = resolvePath(json, items)[0];
    return Array.isArray(found) ? found : [];
}

/** Keys at most `depth` levels down, with their paths: where a response keeps its paging. */
function* walk(node: unknown, path: JsonPath = [], depth = 4): Generator<{ key: string; value: unknown; path: JsonPath }> {
    if (depth < 0 || node === null || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        yield { key, value, path: [...path, key] };
        yield* walk(value, [...path, key], depth - 1);
    }
}

const isLink = (v: unknown): v is string => typeof v === 'string' && /^(https?:\/\/|\/|\?)/.test(v) && v.length < 2000;

/** The response's link to the next page (`next`, `links.next`, `_links.next.href`). */
function findNextLink(json: unknown): JsonPath | null {
    for (const { key, value, path } of walk(json)) {
        if (!NEXT_LINK_KEY.test(key)) continue;
        if (isLink(value)) return path;
        if (value && typeof value === 'object' && isLink((value as any).href)) return [...path, 'href'];
    }
    return null;
}

/** Where the response says the next page starts, when it isn't `current` (the cursor just sent). */
function findNextCursor(json: unknown, current?: string): JsonPath | null {
    let best: JsonPath | null = null;
    for (const { key, value, path } of walk(json)) {
        if (!NEXT_CURSOR_KEY.test(key) || (typeof value !== 'string' && typeof value !== 'number') || value === '' || isLink(value)) continue;
        if (current !== undefined && String(value) === current) continue;
        // A "next…" or "end cursor" over a plain "cursor".
        if (!best || /next|end/i.test(key)) best = path;
    }
    return best;
}

/** Turns the URL a response gives for its next page into an absolute one. */
export function absoluteLink(link: string, base: string): string {
    try { return new URL(link, base).href; } catch { return link; }
}

/**
 * How the recorded call pages through its results, guessed from its parameters and its response:
 * a link to the next page in the response, a cursor the response hands back, an offset, or a page
 * number (also when the first page's call leaves the page out but the response counts its pages).
 */
export function guessPaging(entry: NetEntry, json: unknown, items: JsonPath): ApiPaging {
    const req = toRequest(entry);
    const params = requestParams(req);
    const count = itemsOf(json, items).length;
    const link = findNextLink(json);
    if (link) return { mode: 'link', next: link };

    const cursor = params.find(p => CURSOR_NAME.test(p.name) && !PAGE_NAME.test(p.name) && !SIZE_NAME.test(p.name));
    if (cursor) {
        const next = findNextCursor(json, cursor.value);
        if (next) return { mode: 'cursor', param: cursor, next };
    }
    const offset = params.find(p => OFFSET_NAME.test(p.name) && /^\d+$/.test(p.value));
    if (offset) {
        const size = params.find(p => SIZE_NAME.test(p.name) && /^\d+$/.test(p.value));
        return { mode: 'number', param: offset, start: Number(offset.value), step: Number(size?.value) || count || 20 };
    }
    const page = params.find(p => PAGE_NAME.test(p.name) && /^\d+$/.test(p.value));
    if (page) return { mode: 'number', param: page, start: Number(page.value), step: 1 };

    // A cursor the response gives without a parameter recorded yet (the first page sends none).
    const nextCursor = findNextCursor(json);
    if (nextCursor) {
        const key = String(nextCursor[nextCursor.length - 1]);
        const name = /end_?cursor/i.test(key) ? 'after' : /token/i.test(key) ? 'pageToken' : 'cursor';
        return { mode: 'cursor', param: { where: 'query', name, value: '' }, next: nextCursor };
    }
    // The response counts its pages: the first page's call simply left `page` out.
    for (const { key, value } of walk(json, [], 2)) {
        if (TOTAL_PAGES_KEY.test(key) && Number(value) > 1) return { mode: 'number', param: { where: 'query', name: 'page', value: '1' }, start: 1, step: 1 };
    }
    return { mode: 'none' };
}

// ---- Templates and runs ----

/** The recorded call as a request to send again (headers the browser sets itself left out). */
export function toRequest(entry: NetEntry): ApiRequest {
    const method = entry.method.toUpperCase();
    return {
        url: entry.url,
        method,
        headers: exportableHeaders(entry, true),
        ...(entry.requestBody && method !== 'GET' && method !== 'HEAD' ? { body: entry.requestBody } : {}),
    };
}

/** Where a series of pages is: the first page, or where the last page said the next one is. */
export interface PageState {
    page: number;
    request: ApiRequest;
    /** The cursor just sent (a repeat means the end). */
    cursor?: string;
}

const INPUT_MARK = 'crawlpilot-input';

/**
 * The run's units: one per input value (or one for the call as recorded), each the first page's URL.
 * A value that only goes in the body is kept in the URL's fragment, so a unit is a plain string a
 * re-run can be given again.
 */
export function unitsFor(spec: ApiSpec, values: string[] = []): string[] {
    const list = spec.input ? values.map(v => v.trim()).filter(Boolean) : [];
    if (!spec.input || list.length === 0) return [firstPage(spec).request.url];
    return [...new Set(list)].map(v => {
        const url = firstPage(spec, v).request.url;
        return spec.input!.where === 'query' ? url : `${url.split('#')[0]}#${INPUT_MARK}=${encodeURIComponent(v)}`;
    });
}

/** The input value a unit stands for (undefined: the call as recorded). */
export function unitInput(spec: ApiSpec, unit: string): string | undefined {
    if (!spec.input) return undefined;
    const mark = unit.split('#')[1];
    if (mark?.startsWith(`${INPUT_MARK}=`)) return decodeURIComponent(mark.slice(INPUT_MARK.length + 1));
    if (spec.input.where === 'query') {
        try { return new URL(unit).searchParams.get(spec.input.name) ?? undefined; } catch { return undefined; }
    }
    return undefined;
}

/** The first page's request, for `input` when given. */
export function firstPage(spec: ApiSpec, input?: string): PageState {
    let request = spec.request;
    if (spec.input && input !== undefined) request = setParam(request, spec.input, input);
    const p = spec.paging;
    if (p.mode === 'number') request = setParam(request, p.param, p.start);
    // A recorded cursor is where the user had scrolled to: start from the beginning.
    if (p.mode === 'cursor' && p.param.value) request = dropParam(request, p.param);
    return { page: 1, request };
}

function dropParam(req: ApiRequest, param: ApiParam): ApiRequest {
    if (param.where === 'query') {
        const url = new URL(req.url);
        url.searchParams.delete(param.name);
        return { ...req, url: url.href };
    }
    return setParam(req, param, '');
}

/** The next page's request, from this page's response; null at the end. */
export function nextPage(spec: ApiSpec, state: PageState, json: unknown, count: number): PageState | null {
    if (count === 0 || state.page >= spec.maxPages) return null;
    const p = spec.paging;
    switch (p.mode) {
        case 'none':
            return null;
        case 'number':
            return { page: state.page + 1, request: setParam(state.request, p.param, p.start + p.step * state.page) };
        case 'cursor': {
            const v = resolvePath(json, p.next)[0];
            if ((typeof v !== 'string' && typeof v !== 'number') || v === '' || String(v) === state.cursor) return null;
            return { page: state.page + 1, request: setParam(state.request, p.param, String(v)), cursor: String(v) };
        }
        case 'link': {
            const v = resolvePath(json, p.next)[0];
            if (!isLink(v)) return null;
            const url = absoluteLink(v, state.request.url);
            if (url === state.request.url) return null;
            return { page: state.page + 1, request: { ...state.request, url } };
        }
    }
}

/** What the run says about a call the site refused, in plain words. */
export function refusal(status: number): string {
    if (status === 401 || status === 403) return `The site refused the call (${status}). Sign in on the site, or record the call again: the token it sent may have expired.`;
    if (status === 404) return 'The site no longer answers this call (404). Record it again from the page.';
    if (status === 429) return 'The site asks to slow down (429).';
    return `The site answered ${status}.`;
}

/** A short description of the paging, for the screen. */
export function pagingLabel(p: ApiPaging): string {
    switch (p.mode) {
        case 'none': return 'One page only';
        case 'number': return p.step === 1 ? `Page number: ${p.param.name}=${p.start}, ${p.start + 1}, …` : `Offset: ${p.param.name}=${p.start}, ${p.start + p.step}, …`;
        case 'cursor': return `Cursor: ${p.param.name} from the response's ${p.next.join('.')}`;
        case 'link': return `Next-page link in the response (${p.next.join('.')})`;
    }
}

/** The response's main list when the user didn't search for a value: its longest array of objects. */
export function mainList(json: unknown): JsonPath | null {
    let best: { path: JsonPath; n: number } | null = null;
    const visit = (node: unknown, path: JsonPath, depth: number) => {
        if (depth > 6 || node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            if (node.length > (best?.n ?? 0) && node.some(v => v && typeof v === 'object' && !Array.isArray(v))) best = { path, n: node.length };
            return;
        }
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) visit(v, [...path, k], depth + 1);
    };
    visit(json, [], 0);
    return (best as { path: JsonPath } | null)?.path ?? null;
}
