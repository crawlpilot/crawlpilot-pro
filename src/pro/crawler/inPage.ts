/**
 * What a crawler worker runs inside each page, bundled into one script (`vite.crawler.config.ts`): the
 * extension's own `extractPage`, unchanged, so a page reads the same here as in Test on this page; then
 * every way of every field and click checked on its own, for selector usage.
 * - matched: the way finds something on the page (its selector an element, its binding a value);
 * - won: the way the extractor used (page data when the field came from data, else the selector
 *   `resolveOne` picks); a healed or empty field has no winner.
 * For a list recipe: each list's rows read with its frozen fields (`readWhenReady`, as the List Extractor
 * reads them), and its Next control found: its link, when it is one, or clicked, when it is a button.
 * Nothing here talks to the extension: it is plain DOM code.
 */
import { extractPage } from '../../content/services/page/extractPage';
import { readBinding } from '../../content/services/page/dataBinding';
import type { ElementDefinition, ExtractionConfig } from '../../content/services/page/types';
import { readWhenReady, type ReaderColumn } from '../../content/services/extraction/fields';
import { resolveContainer, resolveItems, resolveOne } from '../../shared/selectors/resolve';
import type { StepResult } from '../../shared/listing/stepStats';
import type { Chain, DataBinding, ListTarget } from '../../shared/types/database';
import type { PageRule, WayHit } from '../../shared/types/ways';

/** One field's or click's ways, by id, in the order the extractor tries them. */
export interface WayProbe {
    elementId: string;
    data?: { wayId: string; binding: DataBinding };
    selectors: { wayId: string; selector: string }[];
}

export interface InPageRequest {
    elements: ElementDefinition[];
    config: ExtractionConfig;
    probes: WayProbe[];
}

export interface WayUse {
    wayId: string;
    /** False for a click the extractor skipped (what it reveals came from page data). */
    tried: boolean;
    matched: boolean;
    won: boolean;
}

export interface InPageResult {
    item: Record<string, unknown>;
    /** A field read way by way has what each way read (`hits`); its usage is worked out from them (`recipeRun.ts`). */
    steps: (StepResult & { hits?: WayHit[] })[];
    ways: WayUse[];
    /** A page rule held: nothing was read. */
    rule?: Pick<PageRule, 'name' | 'status'>;
}

const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

/** Steps that used a selector: an extracted field read from the DOM, or a click that did something. */
const USED_SELECTOR = new Set(['ok', 'clicked', 'opened', 'already-open']);

export async function run({ elements, config, probes }: InPageRequest): Promise<InPageResult> {
    const { item, steps, rule } = await extractPage(elements, config) as Omit<InPageResult, 'ways'>;
    if (rule) return { item, steps, ways: [], rule };
    const status = new Map(steps.map(s => [s.id, s.status as string]));
    const ways: WayUse[] = [];
    for (const probe of probes) {
        const step = status.get(probe.elementId);
        const tried = step !== 'skipped';
        if (probe.data) {
            ways.push({ wayId: probe.data.wayId, tried, matched: tried && filled(readBinding(probe.data.binding)), won: step === 'data' });
        }
        const used = step && USED_SELECTOR.has(step) ? resolveOne(probe.selectors.map(s => s.selector)).used : -1;
        probe.selectors.forEach((s, i) => {
            ways.push({ wayId: s.wayId, tried, matched: tried && resolveOne([s.selector]).result !== null, won: i === used });
        });
    }
    return { item, steps, ways };
}

export interface ListPageRequest {
    lists: ListTarget[];
    /** The Next / Load more control, when the list has one. */
    next?: Chain;
    settleMs: number;
}

export interface ListPageResult {
    /** Each list's rows, keyed by column id, in page order. */
    lists: { id: string; rows: Record<string, string>[] }[];
    /** The Next control's link, when it is one: the next page is a job of its own. */
    nextHref?: string;
    /** A Next control that can be clicked (present and not disabled). */
    hasNext: boolean;
}

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function disabled(el: Element): boolean {
    return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/i.test(el.getAttribute('class') ?? '');
}

export async function readLists({ lists, next, settleMs }: ListPageRequest): Promise<ListPageResult> {
    const out: ListPageResult['lists'] = [];
    for (const list of lists) {
        const container = resolveContainer(list.container, list.items).result;
        const items = list.mode === 'single' ? (container ? [container] : []) : resolveItems(list.items, container ?? document).result;
        const rows: Record<string, string>[] = [];
        for (const item of items) {
            const { item: row } = await readWhenReady(item, list.fields as ReaderColumn[], () => wait(settleMs));
            if (Object.keys(row).length) rows.push(row);
        }
        out.push({ id: list.id, rows });
    }
    const control = next?.length ? resolveOne(next).result : null;
    const link = control?.closest('a')?.href;
    const nextHref = link && /^https?:/i.test(link) && link.split('#')[0] !== location.href.split('#')[0] ? link : undefined;
    return { lists: out, ...(nextHref ? { nextHref } : {}), hasNext: !!control && !disabled(control) };
}

/** Clicks the Next / Load more control; false when there is none to click. */
export function clickNext(next: Chain): boolean {
    const el = resolveOne(next).result as HTMLElement | null;
    if (!el || disabled(el)) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
}

/** Scrolls to the end until the page stops growing, at most `max` times; how many scrolls it took. */
export async function scrollToEnd(max: number, settleMs: number): Promise<number> {
    let height = document.documentElement.scrollHeight;
    for (let i = 0; i < max; i++) {
        window.scrollTo(0, document.documentElement.scrollHeight);
        await wait(settleMs);
        const now = document.documentElement.scrollHeight;
        if (now === height) return i + 1;
        height = now;
    }
    return max;
}

(globalThis as unknown as { crawlpilot: object }).crawlpilot = { run, readLists, clickNext, scrollToEnd };
