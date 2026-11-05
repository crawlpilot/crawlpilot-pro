/**
 * The cleanup a recipe's selector usage suggests (`wayHealth.ts`), as the next version's spec: dead ways
 * removed, dormant selectors moved after the ones that win, and dead ones that stay (kept, or needed to keep
 * a field's minimum) after those, so a way that finds nothing is never tried before one that does. Nothing is applied by itself: the result is
 * saved as a `pruned` version that is tested, reviewed and submitted like any other.
 * What it never does: leave a field or click with no way, take a required field below 2 ways, or below 2
 * kinds of way when it had them, or move page data from the front (it is always tried first). A change
 * someone chose to keep (`db/dismissals.ts`) is left out: it is never proposed again.
 */
import type { ProSpec, SessionSetup, Step, Way } from './types';
import type { WayState } from './wayHealth';

export type CleanupAction = 'removed' | 'moved last';

/** A change by way id, as kept dismissals are keyed. */
export const cleanupKey = (wayId: string | undefined, action: CleanupAction) => `${wayId}:${action}`;

export interface CleanupChange {
    owner: string;
    way: Way;
    action: CleanupAction;
    state: WayState;
}

export interface Cleanup {
    spec: ProSpec;
    changes: CleanupChange[];
}

function cleanWays(ways: Way[], states: Map<string, WayState>, kept: Set<string>, required: boolean, owner: string, changes: CleanupChange[]): Way[] {
    const stateOf = (w: Way) => (w.id && states.get(w.id)) || 'no-data';
    const keepMin = required ? 2 : 1;
    const kinds = (list: Way[]) => new Set(list.map(w => w.kind)).size;

    let left = [...ways];
    for (const way of ways.filter(w => stateOf(w) === 'dead' && !kept.has(cleanupKey(w.id, 'removed'))).reverse()) {
        const without = left.filter(w => w !== way);
        if (without.length < keepMin) continue;
        if (required && kinds(left) >= 2 && kinds(without) < 2) continue;
        left = without;
        changes.push({ owner, way, action: 'removed', state: 'dead' });
    }

    // Selectors that win nothing go last: dormant first, then dead. Page data stays in front.
    const trailing = (w: Way, state: WayState) => w.kind === 'selector' && stateOf(w) === state && !kept.has(cleanupKey(w.id, 'moved last'));
    const back = (w: Way) => trailing(w, 'dormant') || trailing(w, 'dead');
    const reordered = [...left.filter(w => !back(w)), ...left.filter(w => trailing(w, 'dormant')), ...left.filter(w => trailing(w, 'dead'))];
    reordered.forEach((w, i) => {
        if (back(w) && i > left.indexOf(w)) changes.push({ owner, way: w, action: 'moved last', state: stateOf(w) });
    });
    return reordered;
}

/** `kept`: the changes someone chose to keep, by `cleanupKey`. */
export function proposeCleanup(spec: ProSpec, states: Map<string, WayState>, kept: Set<string> = new Set()): Cleanup {
    const changes: CleanupChange[] = [];
    const clean = (steps: Step[]): Step[] => steps.map(s => s.kind === 'field'
        ? { kind: 'field', field: { ...s.field, ways: cleanWays(s.field.ways, states, kept, !!s.field.required, s.field.name, changes) } }
        : { kind: 'click', click: { ...s.click, ways: cleanWays(s.click.ways, states, kept, false, `click: ${s.click.name}`, changes) } });
    const cleanSetup = (setup: SessionSetup): SessionSetup => ({
        ...setup,
        steps: setup.steps.map(c => ({ ...c, ways: cleanWays(c.ways, states, kept, false, `setup: ${c.name}`, changes) })),
        ...(setup.dismiss ? { dismiss: setup.dismiss.map(c => ({ ...c, ways: cleanWays(c.ways, states, kept, false, `dismiss: ${c.name}`, changes) })) } : {}),
        ...(setup.check ? { check: { ...setup.check, ways: cleanWays(setup.check.ways, states, kept, false, 'setup: check', changes) } } : {}),
    });
    const setup = spec.setup ? { setup: cleanSetup(spec.setup) } : {};
    const next: ProSpec = spec.kind === 'page' ? { ...spec, ...setup, steps: clean(spec.steps) }
        : spec.details ? { ...spec, ...setup, details: { ...spec.details, spec: { ...spec.details.spec, steps: clean(spec.details.spec.steps) } } }
        : { ...spec, ...setup };
    return { spec: changes.length ? next : spec, changes };
}
