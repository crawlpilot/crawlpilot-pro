/**
 * Recipe specs and the run inputs they come from and go back to. A run is started from the side
 * panel's picker state (list selectors, Page Extractor elements); what is stored is a typed spec with
 * plain selector chains (`shared/types/database.ts`). This module is the only place the two meet, and
 * the v6 migration reads saved v5 configs through it too.
 */
import type { Chain, Column, ListSpec, PageSpec, RecipeSpec } from '../types/database';
import type { PaginationConfig, SelectorState } from '../types/extraction';
import { hashString } from '../utils/hash';
import { looksLikeXPath, normalizeChain } from '../selectors/resolve';
import type { RawChainEntry } from '../selectors/types';
import { isVolatileSelector } from '../selectors/stability';

const MAX_CHAIN = 3;

/**
 * A stored chain from any picker shape: strings, `{ selector }`, `{ type, value }`. Duplicates and
 * volatile entries (hash classes, positions) are dropped unless nothing else is left; at most three.
 */
export function chainOf(entries: (RawChainEntry | null | undefined)[] | null | undefined): Chain {
    const values = [...new Set(normalizeChain(entries).map(e => e.value))];
    const stable = values.filter(v => !isVolatileSelector(v));
    return (stable.length > 0 ? stable : values).slice(0, MAX_CHAIN);
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value as object).sort().map(k => [k, sortKeys((value as Record<string, unknown>)[k])]));
    }
    return value;
}

/** The spec as canonical JSON: key order never matters. */
export function specJson(spec: RecipeSpec): string {
    return JSON.stringify(sortKeys(spec));
}

/** A short identity for a spec (two 32-bit hashes); equal specs are confirmed by `specJson`. */
export function specHash(spec: RecipeSpec): string {
    const json = specJson(spec);
    const reversed = json.split('').reverse().join('');
    return `${(hashString(json) >>> 0).toString(36)}${(hashString(reversed) >>> 0).toString(36)}`;
}

// ---- Lists (List Extractor) ----

export function listSpec(selectors: SelectorState[], pagination: PaginationConfig): ListSpec {
    return {
        kind: 'list',
        lists: selectors.map(s => ({
            id: s.id,
            container: chainOf([...(s.containerSelectors ?? []), s.containerSelector, s.containerXPath]),
            items: chainOf([...(s.itemSelectors ?? []), s.itemSelector, s.itemXPath]),
            fields: (s.data?.columns ?? []) as Column[],
            mode: s.patternFound === false ? 'single' : 'list',
        })),
        pagination: {
            mode: pagination.mode,
            ...(pagination.nextButtonSelector || pagination.nextButtonSelectors?.length
                ? { next: chainOf([...(pagination.nextButtonSelectors ?? []), pagination.nextButtonSelector]) }
                : {}),
            ...(pagination.speed ? { speed: pagination.speed } : {}),
        },
    };
}

/** The picker state a list run starts from, rebuilt from a stored spec (reruns). The page limit is the run's. */
export function listRunInput(spec: ListSpec, maxPages?: number): { selectors: SelectorState[]; pagination: PaginationConfig } {
    const meta = (chain: Chain) => chain.map(selector => ({ selector, strategy: looksLikeXPath(selector) ? 'xpath' : 'css' }));
    const firstCss = (chain: Chain) => chain.find(s => !looksLikeXPath(s)) ?? chain[0] ?? '';
    return {
        selectors: spec.lists.map(l => ({
            id: l.id,
            containerSelector: firstCss(l.container),
            containerSelectors: meta(l.container),
            itemSelector: firstCss(l.items),
            itemSelectors: meta(l.items),
            data: { columns: l.fields, items: [] },
            patternFound: l.mode === 'list',
            count: 0,
            selectionMode: 'list',
        })),
        pagination: {
            mode: spec.pagination.mode,
            nextButtonSelector: spec.pagination.next?.[0] ?? null,
            nextButtonSelectors: meta(spec.pagination.next ?? []),
            maxPages,
            speed: spec.pagination.speed,
        },
    };
}

// ---- Pages (Page Extractor, bulk runs) ----

/** A Page Extractor element as the side panel and the content script hold it. */
export interface RunElement {
    id: string;
    name: string;
    action: 'extract' | 'click';
    type?: string;
    selectors: { type: string; value: string }[];
    fields?: unknown;
    [key: string]: unknown;
}

export function pageSpec(elements: RunElement[], settings: Record<string, unknown>): PageSpec {
    return {
        kind: 'page',
        elements: elements.map(e => ({
            id: e.id,
            name: e.name,
            action: e.action === 'click' ? 'click' : 'extract',
            type: e.type || 'text',
            selectors: chainOf(e.selectors),
            ...(Array.isArray(e.fields) && e.fields.length > 0 ? { fields: e.fields as Column[] } : {}),
        })),
        settings,
    };
}

export function pageRunInput(spec: PageSpec): { elements: RunElement[]; settings: Record<string, unknown> } {
    return {
        elements: spec.elements.map(e => ({
            id: e.id,
            name: e.name,
            action: e.action,
            type: e.type,
            selectors: e.selectors.map(value => ({ type: looksLikeXPath(value) ? 'xpath' : 'css', value })),
            ...(e.fields ? { fields: e.fields } : {}),
        })),
        settings: spec.settings,
    };
}

// ---- v5 configs (migration) ----

/** A v5 recipe or job config (`{ type, urls, options }`) as a spec, or null when it can't be read. */
export function specFromV5(config: any): RecipeSpec | null {
    if (!config || typeof config !== 'object') return null;
    const options = config.options ?? {};
    if (config.type === 'list-extraction' && Array.isArray(options.fullSelectors) && options.pagination) {
        return listSpec(options.fullSelectors, options.pagination);
    }
    if (config.type === 'bulk-extraction') {
        const action = Array.isArray(options.actions) ? options.actions[0] : undefined;
        if (!Array.isArray(action?.elements)) return null;
        return pageSpec(action.elements, action.config ?? {});
    }
    if (config.type === 'metadata-extraction') return { kind: 'metadata', options };
    return null;
}
