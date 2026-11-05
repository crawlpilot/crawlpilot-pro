/**
 * Stable ids for ways, so a way's usage on crawls adds up across versions. A save gives every way an id:
 * - a way that kept its id and still reads the same as that id did in the base version keeps it;
 * - a way without one (just picked, typed or imported) takes the id of the same way under the same field
 *   or click in the base version, matched by its canonical form;
 * - anything else is a new way, with a new id, first seen in the version being saved.
 * So an edited selector is a new way, and a renamed field keeps its ways (fields match by id, then name).
 */
import { setupOwners } from './actions';
import { canonicalString } from './canonical';
import type { ProSpec, Step, Way } from './types';

/** A list of ways and what it belongs to: a field or a click, by id and by name. */
interface WayOwner {
    key: string;
    name: string;
    ways: Way[];
    setWays(ways: Way[]): Step;
}

function owners(steps: Step[], prefix = ''): WayOwner[] {
    return steps.map(s => s.kind === 'field'
        ? { key: `${prefix}field:${s.field.id}`, name: `${prefix}field:${s.field.name}`, ways: s.field.ways, setWays: ways => ({ kind: 'field', field: { ...s.field, ways } }) }
        : { key: `${prefix}click:${s.click.id}`, name: `${prefix}click:${s.click.name}`, ways: s.click.ways, setWays: ways => ({ kind: 'click', click: { ...s.click, ways } }) });
}

function stepsOf(spec: ProSpec): Step[] {
    return spec.kind === 'page' ? spec.steps : spec.details?.spec.steps ?? [];
}

function withSteps(spec: ProSpec, steps: Step[]): ProSpec {
    if (spec.kind === 'page') return { ...spec, steps };
    return spec.details ? { ...spec, details: { ...spec.details, spec: { ...spec.details.spec, steps } } } : spec;
}

/** What a way reads, without its identity: two ways with the same key are the same way. */
export function wayKey(way: Way): string {
    return canonicalString(way);
}

/** Every way in a spec, with the field, click or setup step it belongs to. */
export function listWays(spec: ProSpec): { owner: string; way: Way }[] {
    return [
        ...setupOwners(spec.setup).flatMap(o => o.ways.map(way => ({ owner: o.name, way }))),
        ...owners(stepsOf(spec)).flatMap(o => o.ways.map(way => ({ owner: o.name.replace(/^(field|click):/, ''), way }))),
    ];
}

export function assignWayIds(spec: ProSpec, version: number, base?: ProSpec, newId: () => string = () => crypto.randomUUID()): ProSpec {
    const before: { key: string; name: string; ways: Way[] }[] = base ? [...owners(stepsOf(base)), ...setupOwners(base.setup)] : [];
    const byId = new Map(before.flatMap(o => o.ways.filter(w => w.id).map(w => [w.id!, w] as const)));
    const used = new Set<string>();
    const withIds = (owner: { key: string; name: string; ways: Way[] }): Way[] => {
        const old = before.find(o => o.key === owner.key) ?? before.find(o => o.name === owner.name);
        const oldIds = new Set(old?.ways.map(w => w.id));
        const ways = owner.ways.map(way => {
            const key = wayKey(way);
            // An id the base has elsewhere (another field, or reading something else) is not this way's.
            const kept = !!way.id && !used.has(way.id) && (!byId.has(way.id) || (oldIds.has(way.id) && wayKey(byId.get(way.id)!) === key));
            const match = kept ? undefined : old?.ways.find(w => w.id && !used.has(w.id) && wayKey(w) === key);
            const id = kept ? way.id! : match?.id ?? newId();
            used.add(id);
            const addedIn = kept ? way.addedIn ?? byId.get(id)?.addedIn ?? version : match?.addedIn ?? version;
            return { ...way, id, addedIn };
        });
        return ways;
    };
    const steps = owners(stepsOf(spec)).map(owner => owner.setWays(withIds(owner)));
    const next = withSteps(spec, steps);
    if (!spec.setup) return next;
    const { setup } = spec;
    return {
        ...next,
        setup: {
            ...setup,
            steps: setup.steps.map(c => ({ ...c, ways: withIds({ key: `setup:${c.id}`, name: `setup: ${c.name}`, ways: c.ways }) })),
            ...(setup.dismiss ? { dismiss: setup.dismiss.map(c => ({ ...c, ways: withIds({ key: `dismiss:${c.id}`, name: `dismiss: ${c.name}`, ways: c.ways }) })) } : {}),
            ...(setup.check ? { check: { ...setup.check, ways: withIds({ key: 'setup:check', name: 'setup: check', ways: setup.check.ways }) } } : {}),
        },
    };
}
