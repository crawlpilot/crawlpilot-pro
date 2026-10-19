/**
 * Reveal hidden content before a page is read as markdown (docs/plans/ai-extract-v2-plan.md §3.1a).
 * Used by every markdown reader: AI Extract and the Page assistant (`AI_PAGE_VIEW`), and the metadata
 * extractor ("Article text & details", one page or a bulk run).
 *
 * - `off`: read what is rendered, as before.
 * - `read`: also read panels already in the page behind a visible control (no clicks).
 * - `open`: also click what only appears on a click, within a budget, then put the page back.
 *
 * The caller builds its markdown with `markdownOptions` (the panels and captured tab panels), then calls
 * `restore`.
 */
import { disclosurePanels, type Panel } from './disclosure';
import { expandHidden, type RevealBudget } from './expand';
import type { RevealMode, RevealReport } from '../../../shared/types/reveal';

export { revealSummary, type RevealMode, type RevealReport } from '../../../shared/types/reveal';

/** The side panel, with the user waiting: a little more room. */
export const INTERACTIVE_BUDGET: RevealBudget = { clicks: 20, ms: 6000 };
/** Every page of a bulk run pays it: tighter. */
export const BULK_BUDGET: RevealBudget = { clicks: 10, ms: 4000 };

export interface Revealed {
    report: RevealReport;
    markdownOptions: { reveal?: Map<Element, Panel>; extra?: { label: string; el: Element }[] };
    restore: () => Promise<void>;
}

const nothing = async () => undefined;

/**
 * Clicking to reveal ('open') is switched off for now: on single-page shops a click could still
 * swap the page for another view (Walmart's reviews). 'open' reads as 'read': panels already in
 * the page behind a control are read, nothing is clicked. Turn back on to re-enable `expandHidden`.
 */
export const CLICK_TO_REVEAL = false;

export async function revealForReading(mode: RevealMode = 'read', budget: RevealBudget = INTERACTIVE_BUDGET, doc: Document = document, live = true): Promise<Revealed> {
    const empty: RevealReport = { read: [], opened: [], tabs: [], skipped: [], clicks: 0 };
    if (mode === 'off') return { report: empty, markdownOptions: {}, restore: nothing };
    let opened: Awaited<ReturnType<typeof expandHidden>> | null = null;
    if (mode === 'open' && CLICK_TO_REVEAL) {
        try { opened = await expandHidden(budget, doc, live); } catch { opened = null; }
    }
    // After the clicks: a panel opened by a click is simply rendered now, the rest are read as if open.
    const panels = disclosurePanels(doc, live);
    const read = [...new Set([...panels.values()].map(p => p.label).filter(Boolean))];
    return {
        report: {
            read,
            opened: opened?.opened ?? [],
            tabs: opened?.captured.map(c => c.label) ?? [],
            skipped: opened?.skipped ?? [],
            clicks: opened?.clicks ?? 0,
            ...(opened?.stopped ? { stopped: opened.stopped } : {}),
        },
        markdownOptions: { reveal: panels, ...(opened?.captured.length ? { extra: opened.captured } : {}) },
        restore: opened?.restore ?? nothing,
    };
}
