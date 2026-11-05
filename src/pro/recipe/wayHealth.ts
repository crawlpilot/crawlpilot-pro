/**
 * How each way of a recipe is doing on crawls, from its daily counts over the last 30 days. A way is judged
 * only once it was tried on enough pages (`MIN_PAGES`); until then it is:
 * - new: first seen in a version saved in the window;
 * - no data: older, but the recipe did not crawl enough, or the way is not reached.
 * Once judged it is:
 * - active: its value was used at least once;
 * - dormant: it found something but another way always won, so it is a backup nobody needs;
 * - dead: tried and never found anything.
 * The backend counts only pages that loaded, so a blocked page never makes a way look dead.
 */
import { setupOwners } from './actions';
import type { WayDay } from '../backend/types';
import type { ProSpec, Step, Way } from './types';

export const WINDOW_DAYS = 30;
/** Pages a way is tried on in the window before it is judged. */
export const MIN_PAGES = 20;
const DAY = 86_400_000;

export type WayState = 'active' | 'dormant' | 'dead' | 'new' | 'no-data';

export interface WayHealth {
    way: Way;
    state: WayState;
    tried: number;
    matched: number;
    won: number;
    /** The newest day it won, at any time. */
    lastWonAt?: string;
}

export interface OwnerHealth {
    /** "price", or "click: Composition". */
    owner: string;
    required: boolean;
    ways: WayHealth[];
}

function steps(spec: ProSpec): Step[] {
    return spec.kind === 'page' ? spec.steps : spec.details?.spec.steps ?? [];
}

/**
 * `days`: the recipe's counts by way id. `versionDates`: when each version was saved, to know how new a way
 * is (`addedIn`). `now`: the end of the window.
 */
export function wayHealth(spec: ProSpec, days: (WayDay & { wayId: string })[], versionDates: Map<number, number>, now = Date.now()): OwnerHealth[] {
    const since = new Date(now - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
    const one = (way: Way): WayHealth => {
        const mine = days.filter(d => d.wayId === way.id);
        const inWindow = mine.filter(d => d.date >= since);
        const sum = (k: 'tried' | 'matched' | 'won') => inWindow.reduce((n, d) => n + d[k], 0);
        const [tried, matched, won] = [sum('tried'), sum('matched'), sum('won')];
        const lastWonAt = mine.filter(d => d.won > 0).map(d => d.date).sort().pop();
        const added = way.addedIn !== undefined ? versionDates.get(way.addedIn) : undefined;
        const recent = added !== undefined && added > now - WINDOW_DAYS * DAY;
        const state: WayState = tried < MIN_PAGES ? (recent ? 'new' : 'no-data')
            : won > 0 ? 'active' : matched > 0 ? 'dormant' : 'dead';
        return { way, state, tried, matched, won, ...(lastWonAt ? { lastWonAt } : {}) };
    };
    return [
        ...setupOwners(spec.setup).map(o => ({ owner: o.name, required: false, ways: o.ways.map(one) })),
        ...steps(spec).map(s => s.kind === 'field'
            ? { owner: s.field.name, required: !!s.field.required, ways: s.field.ways.map(one) }
            : { owner: `click: ${s.click.name}`, required: false, ways: s.click.ways.map(one) }),
    ];
}
