/**
 * The Recipes screen (docs/plans/product-improvements-plan.md §5, S1): every saved recipe once, with
 * its site, its runs, its last run, and how healthy that run was, so a recipe that started to break
 * is seen before its data goes bad.
 */
import type { Recipe } from '@/shared/types/database';
import { jobKind, jobUrl, type JobWithRecipe } from './jobFilters';

export type Health = 'good' | 'warn' | 'bad' | 'running';

export interface RecipeEntry {
    recipe: Recipe;
    kind: Recipe['spec']['kind'];
    site: string;
    runs: number;
    /** The newest run, and the newest that wrote data (the one to open). */
    last: JobWithRecipe;
    lastWithData?: JobWithRecipe;
    health: Health;
    /** Why, shortest first: "Price found again by meaning", "2 pages failed". */
    notes: string[];
}

/** A field filled in fewer rows than this is worth a look. */
const LOW_FILL = 0.5;

const host = (url?: string) => { try { return url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { return ''; } };

/** How the run went, from what it recorded: failed or broken fields are bad; healed, sparse or walls a warning. */
export function healthOf(job: JobWithRecipe): { health: Health; notes: string[] } {
    if (job.status === 'running') return { health: 'running', notes: ['Running now'] };
    const s = job.stats ?? { startTime: 0, itemsExtracted: 0 };
    const bad: string[] = [];
    const warn: string[] = [];
    if (job.status === 'failed') bad.push(job.error ? `Failed: ${job.error}` : 'The run failed');
    else if ((s.itemsExtracted ?? 0) === 0 && !s.stoppedByUser) bad.push('No rows read');

    const pages = s.pageStats ?? [];
    const broken = [...new Set(pages.flatMap(p => p.broken ?? []))];
    const healed = [...new Set(pages.flatMap(p => p.healed ?? []))].filter(f => !broken.includes(f));
    if (broken.length) bad.push(`${broken.join(', ')} could not be found`);
    if (healed.length) warn.push(`${healed.join(', ')} found again by meaning`);
    if (pages.some(p => p.fallback)) warn.push('A backup selector found the list');

    const sparse = (s.coverage ?? []).filter(c => c.fill < LOW_FILL && !broken.includes(c.name));
    if (sparse.length) warn.push(`${sparse.map(c => `${c.name} ${Math.round(c.fill * 100)}%`).join(', ')} filled`);
    if (s.errors) warn.push(`${s.errors} page${s.errors === 1 ? '' : 's'} failed`);
    const walls = Object.entries(s.verdicts ?? {}).filter(([v, n]) => v !== 'ok' && n > 0);
    if (walls.length) warn.push(walls.map(([v, n]) => `${n} ${v.replace(/_/g, ' ')}`).join(', '));
    if (s.stoppedByUser) warn.push('Stopped before the end');

    if (bad.length) return { health: 'bad', notes: [...bad, ...warn] };
    if (warn.length) return { health: 'warn', notes: warn };
    return { health: 'good', notes: [] };
}

/** One entry per recipe, newest run first. Jobs without a recipe (removed) are left out. */
export function recipeEntries(jobs: JobWithRecipe[]): RecipeEntry[] {
    const byRecipe = new Map<number, JobWithRecipe[]>();
    for (const j of jobs) {
        if (!j.recipe?.id) continue;
        const list = byRecipe.get(j.recipe.id) ?? [];
        list.push(j);
        byRecipe.set(j.recipe.id, list);
    }
    const out: RecipeEntry[] = [];
    for (const runs of byRecipe.values()) {
        runs.sort((a, b) => b.createdAt - a.createdAt);
        const last = runs[0];
        const { health, notes } = healthOf(last);
        out.push({
            recipe: last.recipe!,
            kind: jobKind(last)!,
            site: host(jobUrl(last)),
            runs: runs.length,
            last,
            lastWithData: runs.find(r => r.tableId !== undefined),
            health,
            notes,
        });
    }
    return out.sort((a, b) => b.last.createdAt - a.last.createdAt);
}
