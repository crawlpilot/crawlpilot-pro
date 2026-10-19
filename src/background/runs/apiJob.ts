/**
 * An API recipe's run (docs/plans/api-recipes-plan.md): each unit is one series of pages of the
 * site's JSON call (one per input value), sent from a single tab at the page the call was recorded
 * on, so it goes with the page's origin and the user's session. No page is rendered per result page;
 * rows are saved as each page arrives.
 */
import type { ApiStart } from '../../shared/messages';
import type { Column } from '../../shared/types/database';
import type { RunJob } from './JobRunner';
import { firstPage, itemsOf, nextPage, refusal, unitInput, unitsFor, type PageState } from '../../shared/network/apiRecipe';
import { tableFromArray } from '../../shared/network/arrayTable';
import { hashString } from '../../shared/utils/hash';

/** Between two pages of one series. */
const PAGE_GAP_MS = 400;
/** A 429 is waited out this long (doubling), at most this many times. */
const SLOW_DOWN_MS = 5000;
const SLOW_DOWN_TRIES = 3;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const asColumns = (names: string[]): Column[] => names.map((c, i) => ({ id: c, name: c, type: 'text' as const, order: i }));

export function apiJob(start: ApiStart): RunJob {
    const { spec } = start;
    return {
        kind: 'api',
        urls: start.units?.length ? start.units : unitsFor(spec, start.values),
        maxConcurrent: start.maxConcurrent ?? 1,
        settings: { requestDelay: 0, loadTimeout: 30000 },
        via: spec.page,
        jobId: start.jobId,
        name: start.customName,
        spec,
        tableType: 'api',
        columns: found => found,

        async extract(tabId, unit, ctx) {
            const input = unitInput(spec, unit);
            let state: PageState | null = firstPage(spec, input);
            // Items seen in this series: a site that ignores the page parameter sends page one again.
            const seen = new Set<number>();
            while (state && !ctx.stopped()) {
                let res = await ctx.message(tabId, 'CMD_API_FETCH', state.request);
                for (let t = 0; res.success && res.status === 429 && t < SLOW_DOWN_TRIES && !ctx.stopped(); t++) {
                    await sleep(SLOW_DOWN_MS * 2 ** t);
                    res = await ctx.message(tabId, 'CMD_API_FETCH', state.request);
                }
                if (!res.success) throw new Error(state.page === 1 ? `The call could not be sent: ${res.error}` : res.error);
                if (res.status >= 400) {
                    // Pages already read stay; a refusal later on ends the series.
                    if (state.page === 1) throw new Error(refusal(res.status));
                    break;
                }
                let json: unknown;
                try { json = JSON.parse(res.text); } catch { throw new Error(`Page ${state.page} was not JSON (the site may want a sign-in or a bot check: open ${spec.page}).`); }

                const items = itemsOf(json, spec.items);
                const fresh = items.filter(item => {
                    const h = hashString(JSON.stringify(item));
                    if (seen.has(h)) return false;
                    seen.add(h);
                    return true;
                });
                if (fresh.length === 0) break;
                const { columns, rows } = tableFromArray(fresh);
                ctx.emit(input === undefined ? rows : rows.map(r => ({ [spec.input!.name]: input, ...r })),
                    asColumns(input === undefined ? columns : [spec.input!.name, ...columns]));

                state = nextPage(spec, state, json, items.length);
                if (state) await sleep(PAGE_GAP_MS);
            }
            return { rows: [] };
        },
    };
}
