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
