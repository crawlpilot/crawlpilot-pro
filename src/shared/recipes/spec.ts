/**
 * Recipe specs and the picks they are made from. The side panel holds list picks (`ListPick`) and
 * Page Extractor elements with the same chains a recipe stores; a spec adds what a recipe keeps
 * (fields, the mode) and leaves out what belongs to one run (previews, the page limit). The v6
 * migration reads saved v5 configs (six selector fields, `{ type, value }` lists) here too, and only here.
 */
import type { Chain, Column, ListSpec, PageElement, PageSpec, RecipeSpec } from '../types/database';
import type { ListPick, PaginationConfig } from '../types/extraction';
import { hashString } from '../utils/hash';
import { isVolatileSelector } from '../selectors/stability';

const MAX_CHAIN = 3;

/** A chain entry as v5 saved it: a string, `{ selector, strategy }` or `{ type, value }`. */
type V5Entry = string | { selector?: string } | { value?: string } | null | undefined;

/**
 * A stored chain: duplicates and volatile entries (hash classes, positions) dropped unless nothing
 * else is left; at most three. Also reads v5's entry shapes (migration).
 */
export function chainOf(entries: readonly V5Entry[] | null | undefined): Chain {
    const strings = (entries ?? []).map(e => typeof e === 'string' ? e : e && 'selector' in e ? e.selector : e && 'value' in e ? e.value : undefined);
    const values = [...new Set(strings.map(v => v?.trim()).filter((v): v is string => !!v))];
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

export function listSpec(picks: ListPick[], pagination: PaginationConfig): ListSpec {
    return {
        kind: 'list',
        lists: picks.map(p => ({
            id: p.id,
            container: chainOf(p.container),
            items: chainOf(p.items),
            fields: (p.data?.columns ?? []) as Column[],
            mode: p.patternFound === false ? 'single' : 'list',
        })),
        pagination: {
            mode: pagination.mode,
            ...(pagination.next.length > 0 ? { next: chainOf(pagination.next) } : {}),
            ...(pagination.speed ? { speed: pagination.speed } : {}),
        },
    };
}

/** The picks a list run starts from, rebuilt from a stored spec (reruns). The page limit is the run's. */
export function listRunInput(spec: ListSpec, maxPages?: number): { picks: ListPick[]; pagination: PaginationConfig } {
    return {
        picks: spec.lists.map(l => ({
            id: l.id,
            container: l.container,
            items: l.items,
            data: { columns: l.fields, items: [] },
            patternFound: l.mode === 'list',
            count: 0,
        })),
        pagination: { mode: spec.pagination.mode, next: spec.pagination.next ?? [], maxPages, speed: spec.pagination.speed },
    };
}

// ---- Pages (Page Extractor, bulk runs) ----

/** A Page Extractor element as the side panel and the content script hold it: a `PageElement` plus its preview. */
export type RunElement = PageElement & { value?: unknown; [key: string]: unknown };

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
    return { elements: spec.elements.map(e => ({ ...e })), settings: spec.settings };
}

/** v5 list picks: six selector fields and `{ selector, strategy }` lists. */
function picksFromV5(fullSelectors: any[]): ListPick[] {
    return fullSelectors.map(s => ({
        id: s.id,
        container: chainOf([...(s.containerSelectors ?? []), s.containerSelector, s.containerXPath]),
        items: chainOf([...(s.itemSelectors ?? []), s.itemSelector, s.itemXPath]),
        data: s.data,
        patternFound: s.patternFound !== false,
        count: s.count ?? 0,
    }));
}

/** v5 Page Extractor elements: `selectors` as `{ type, value }`. */
function elementsFromV5(elements: any[]): RunElement[] {
    return elements.map(e => ({ ...e, selectors: chainOf(e.selectors) }));
}

// ---- v5 configs (migration) ----

/** A v5 recipe or job config (`{ type, urls, options }`) as a spec, or null when it can't be read. */
export function specFromV5(config: any): RecipeSpec | null {
    if (!config || typeof config !== 'object') return null;
    const options = config.options ?? {};
    if (config.type === 'list-extraction' && Array.isArray(options.fullSelectors) && options.pagination) {
        const p = options.pagination;
        return listSpec(picksFromV5(options.fullSelectors), {
            mode: p.mode, speed: p.speed, next: chainOf([...(p.nextButtonSelectors ?? []), p.nextButtonSelector]),
        });
    }
    if (config.type === 'bulk-extraction') {
        const action = Array.isArray(options.actions) ? options.actions[0] : undefined;
        if (!Array.isArray(action?.elements)) return null;
        return pageSpec(elementsFromV5(action.elements), action.config ?? {});
    }
    if (config.type === 'metadata-extraction') return { kind: 'metadata', options };
    return null;
}
