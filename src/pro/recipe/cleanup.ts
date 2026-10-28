/**
 * The cleanup a recipe's selector usage suggests (`wayHealth.ts`), as the next version's spec: dead ways
 * removed, dormant selectors moved after the ones that win. Nothing is applied by itself: the result is
 * saved as a `pruned` version that is tested, reviewed and submitted like any other.
 * What it never does: leave a field or click with no way, take a required field below 2 ways, or below 2
 * kinds of way when it had them, or move page data from the front (it is always tried first).
 */
import type { ProSpec, Step, Way } from './types';
import type { WayState } from './wayHealth';

export interface CleanupChange {
    owner: string;
    way: Way;
    action: 'removed' | 'moved last';
    state: WayState;
}

export interface Cleanup {
    spec: ProSpec;
    changes: CleanupChange[];
}

function cleanWays(ways: Way[], states: Map<string, WayState>, required: boolean, owner: string, changes: CleanupChange[]): Way[] {
    const stateOf = (w: Way) => (w.id && states.get(w.id)) || 'no-data';
    const keepMin = required ? 2 : 1;
    const kinds = (list: Way[]) => new Set(list.map(w => w.kind)).size;

    let kept = [...ways];
    for (const way of ways.filter(w => stateOf(w) === 'dead').reverse()) {
        const without = kept.filter(w => w !== way);
        if (without.length < keepMin) continue;
        if (required && kinds(kept) >= 2 && kinds(without) < 2) continue;
        kept = without;
        changes.push({ owner, way, action: 'removed', state: 'dead' });
    }

    const dormant = (w: Way) => w.kind === 'selector' && stateOf(w) === 'dormant';
    const reordered = [...kept.filter(w => !dormant(w)), ...kept.filter(dormant)];
    reordered.forEach((w, i) => {
        if (dormant(w) && kept.indexOf(w) !== i) changes.push({ owner, way: w, action: 'moved last', state: 'dormant' });
    });
    return reordered;
}

export function proposeCleanup(spec: ProSpec, states: Map<string, WayState>): Cleanup {
    const changes: CleanupChange[] = [];
    const clean = (steps: Step[]): Step[] => steps.map(s => s.kind === 'field'
        ? { kind: 'field', field: { ...s.field, ways: cleanWays(s.field.ways, states, !!s.field.required, s.field.name, changes) } }
        : { kind: 'click', click: { ...s.click, ways: cleanWays(s.click.ways, states, false, `click: ${s.click.name}`, changes) } });
    const next: ProSpec = spec.kind === 'page' ? { ...spec, steps: clean(spec.steps) }
        : spec.details ? { ...spec, details: { ...spec.details, spec: { ...spec.details.spec, steps: clean(spec.details.spec.steps) } } }
        : spec;
    return { spec: changes.length ? next : spec, changes };
}
