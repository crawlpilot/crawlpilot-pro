/**
 * Page Extractor coverage over a run (`docs/plans/page-extractor-background-plan.md` P5): for each
 * recipe step, how many pages it worked on and how, and the first pages it failed on, so a field
 * that is empty on some pages says why and where.
 */
export type StepStatus = 'ok' | 'data' | 'healed' | 'empty' | 'not-found' | 'clicked' | 'already-open' | 'opened' | 'no-effect' | 'skipped';

export interface StepResult { id: string; name: string; action: 'extract' | 'click'; status: StepStatus }

export interface StepStat {
    name: string;
    action: 'extract' | 'click';
    pages: number;
    /** Pages per status. */
    counts: Partial<Record<StepStatus, number>>;
    /** Share of pages it worked on: a value read (page, data or healed), or a click that did its job. */
    fill: number;
    /** Up to 5 pages it failed on. */
    failing: string[];
}

const WORKED = new Set<StepStatus>(['ok', 'data', 'healed', 'clicked', 'already-open', 'opened', 'skipped']);
const MAX_FAILING = 5;

export function stepStats(pages: { url: string; steps?: StepResult[] }[]): StepStat[] {
    const byId = new Map<string, StepStat>();
    for (const page of pages) {
        for (const s of page.steps ?? []) {
            const stat = byId.get(s.id) ?? { name: s.name, action: s.action, pages: 0, counts: {}, fill: 0, failing: [] };
            stat.pages++;
            stat.counts[s.status] = (stat.counts[s.status] ?? 0) + 1;
            if (!WORKED.has(s.status) && stat.failing.length < MAX_FAILING) stat.failing.push(page.url);
            byId.set(s.id, stat);
        }
    }
    return [...byId.values()].map(s => ({ ...s, fill: s.pages ? Object.entries(s.counts).filter(([k]) => WORKED.has(k as StepStatus)).reduce((n, [, v]) => n + (v ?? 0), 0) / s.pages : 0 }));
}

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
    ok: 'read from the page',
    data: "read from the page's data",
    healed: 'found again (selector changed)',
    empty: 'found but empty',
    'not-found': 'not found',
    clicked: 'clicked',
    'already-open': 'already open',
    opened: 'opened by its markup',
    'no-effect': 'click had no effect',
    skipped: 'click not needed (fields from data)',
};
