/** Stage 1: keep the rows that are items of the list; headers, widgets and ad blocks are left out. */
import { Atom, collectAtoms } from '../atoms';
import { nodeStep } from '../nodeName';
import type { RowGate } from './types';

const GATE_COVER = 0.5;
const GATE_OWN = 0.3;

function jaccard(a: Set<string>, b: Set<string>): number {
    let inter = 0;
    a.forEach(x => { if (b.has(x)) inter++; });
    return inter / (a.size + b.size - inter || 1);
}

function passesGate(profile: Set<string>, gate: RowGate, core: Set<string>): boolean {
    if (profile.size === 0) return false;
    let inter = 0;
    profile.forEach(x => { if (core.has(x)) inter++; });
    return inter / core.size >= gate.cover && inter / profile.size >= gate.own;
}

function buildGate(profiles: Set<string>[]): RowGate | null {
    if (profiles.length < 4) return null;
    // The most typical row: the one most like all the others.
    let medoid = 0;
    let best = -1;
    profiles.forEach((p, i) => {
        let sum = 0;
        profiles.forEach((q, j) => { if (i !== j) sum += jaccard(p, q); });
        if (sum > best) { best = sum; medoid = i; }
    });
    const similar = profiles.filter(p => jaccard(p, profiles[medoid]) >= 0.3);
    const counts = new Map<string, number>();
    similar.forEach(p => p.forEach(sig => counts.set(sig, (counts.get(sig) ?? 0) + 1)));
    const core = [...counts.entries()].filter(([, c]) => c >= similar.length * 0.5).map(([sig]) => sig);
    return core.length >= 2 ? { core, cover: GATE_COVER, own: GATE_OWN } : null;
}

/**
 * A row's structure for the gate: the label path of each value, measured from the row's content root
 * (below any single-child wrappers), so the same card inside an extra wrapper (a sponsored slot)
 * matches while a block with a different structure (a video ad, a widget) doesn't.
 */
function profileOf(row: Element, atoms: Atom[]): Set<string> {
    let depth = 0;
    for (let el = row; el.children.length === 1 && depth < 6; el = el.children[0]) depth++;
    return new Set(atoms.map(a => `${a.path.slice(depth).map(e => nodeStep(e).label).join('>')}@${a.attr}`));
}

/** Whether a row on any page is an item of the list the fields were picked from. */
export function rowFitsGate(row: Element, gate: RowGate): boolean {
    return passesGate(profileOf(row, collectAtoms(row)), gate, new Set(gate.core));
}

/**
 * The gate for the sampled rows (null when there are too few to tell), and which of them pass it.
 *
 * `decided`: the rows are the cards the picker chose (`docs/plans/picker-container-bound-plan.md`).
 * They are all items: the gate is set so every one with content passes (a card missing its rating or
 * its price is still a card), and on a later page it keeps cells like them and leaves out the
 * different ones (a video tile, an empty ad slot).
 */
export function gateRows(rows: Element[], rowsAtoms: Atom[][], decided = false): { gate: RowGate | null; keep: boolean[] } {
    const profiles = rowsAtoms.map((atoms, i) => profileOf(rows[i], atoms));
    let gate = buildGate(profiles);
    if (gate && decided) {
        const core = new Set(gate.core);
        let cover = gate.cover;
        let own = gate.own;
        profiles.filter(p => p.size > 0).forEach(p => {
            let inter = 0;
            p.forEach(x => { if (core.has(x)) inter++; });
            cover = Math.min(cover, inter / core.size);
            own = Math.min(own, inter / p.size);
        });
        // Just under the least typical chosen card.
        gate = { ...gate, cover: Math.max(0, cover - 0.01), own: Math.max(0, own - 0.01) };
    }
    const core = new Set(gate?.core ?? []);
    return { gate, keep: profiles.map(p => !gate || (decided ? p.size > 0 : passesGate(p, gate, core))) };
}
