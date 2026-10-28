/**
 * What a crawler worker runs inside each page, bundled into one script (`vite.crawler.config.ts`): the
 * extension's own `extractPage`, unchanged, so a page reads the same here as in Test on this page; then
 * every way of every field and click checked on its own, for selector usage.
 * - matched: the way finds something on the page (its selector an element, its binding a value);
 * - won: the way the extractor used (page data when the field came from data, else the selector
 *   `resolveOne` picks); a healed or empty field has no winner.
 * Nothing here talks to the extension: it is plain DOM code.
 */
import { extractPage } from '../../content/services/page/extractPage';
import { readBinding } from '../../content/services/page/dataBinding';
import type { ElementDefinition, ExtractionConfig } from '../../content/services/page/types';
import { resolveOne } from '../../shared/selectors/resolve';
import type { StepResult } from '../../shared/listing/stepStats';
import type { DataBinding } from '../../shared/types/database';

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
    steps: StepResult[];
    ways: WayUse[];
}

const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

/** Steps that used a selector: an extracted field read from the DOM, or a click that did something. */
const USED_SELECTOR = new Set(['ok', 'clicked', 'opened', 'already-open']);

export async function run({ elements, config, probes }: InPageRequest): Promise<InPageResult> {
    const { item, steps } = await extractPage(elements, config) as { item: Record<string, unknown>; steps: StepResult[] };
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

(globalThis as unknown as { crawlpilot: { run: typeof run } }).crawlpilot = { run };
