/**
 * How many pages a run reads at once on this computer: one per GB of memory and per two cores, 1–5.
 * A retail page takes 300–500 MB, so three at once on a 4 GB laptop makes it swap
 * (`docs/plans/performance-plan.md` P4). Chrome reports memory coarsely (≤ 8 GB) and not everywhere.
 */
export function defaultConcurrency(nav: { deviceMemory?: number; hardwareConcurrency?: number } = navigator as any): number {
    const memoryGB = nav.deviceMemory ?? 4;
    const cores = nav.hardwareConcurrency ?? 4;
    return Math.max(1, Math.min(Math.floor(memoryGB), Math.floor(cores / 2), 5));
}

/** The "Tabs at a time" hint: what suits this computer, and what more than that does. */
export function tabsHint(chosen: number, suited: number): string {
    const fit = `${suited} tab${suited === 1 ? '' : 's'} at a time suit${suited === 1 ? 's' : ''} this computer`;
    return chosen > suited ? `${fit}. More may slow it down; the run eases off if it struggles.` : `${fit} (max 5)`;
}
