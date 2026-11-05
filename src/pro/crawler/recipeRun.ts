/**
 * A recipe version as the in-page script runs it, and its result read back the way Pro's own tests read
 * it: `toPageSpec` makes the extractor's elements, `readPageResult` cleans and checks each field. So a page
 * gives the same values here as in Test on this page. A list recipe's rows are named by their columns, and
 * its details pages become jobs of their own, pinned to the same version.
 */
import { toPageSpec } from '../recipe/fromPublic';
import { setupOwners } from '../recipe/actions';
import type { ListRecipeSpec, PageRecipeSpec, ProSpec, RunSettings, SessionSetup, Way } from '../recipe/types';
import { readStepsResult, type FieldResult } from '../runner/readPage';
import type { StepsRead } from '../steps/runner';
import { CrawlError } from './classify';
import type { InPageRequest, InPageResult, ListPageResult, WayProbe } from './inPage';
import type { CrawlJob, RecipeRef, ScrapeDoc, SelectorUsageDoc } from './types';

const wayId = (way: Way, owner: string, i: number) => way.id ?? `${owner}:${i}`;

export function inPageRequest(spec: PageRecipeSpec, settings: RunSettings): InPageRequest {
    const { elements } = toPageSpec(spec, settings);
    const probes: WayProbe[] = spec.steps.map(s => {
        const [id, ways] = s.kind === 'field' ? [s.field.id, s.field.ways] : [s.click.id, s.click.ways];
        const data = ways.findIndex(w => w.kind === 'data');
        const dataWay = ways[data];
        return {
            elementId: id,
            ...(dataWay?.kind === 'data' ? { data: { wayId: wayId(dataWay, id, data), binding: dataWay.binding } } : {}),
            selectors: ways.flatMap((w, i) => w.kind === 'selector' ? [{ wayId: wayId(w, id, i), selector: w.selector }] : []),
        };
    });
    return { elements, config: { ...settings, listOutput: 'nested' }, probes };
}

export interface RunRead {
    attributes: ScrapeDoc['attributes'];
    fieldStatus: ScrapeDoc['fieldStatus'];
    ways: SelectorUsageDoc['ways'];
    filled: number;
    total: number;
    /** A "for each" step's items: one row each, the page's other fields repeated in every row. */
    rows?: { option: { step: string; value: string }; attributes: ScrapeDoc['attributes']; fieldStatus: ScrapeDoc['fieldStatus'] }[];
}

/** `setup`: the version's session setup, whose ways' usage comes with the result. */
export function readRun(spec: PageRecipeSpec, url: string, result: InPageResult & Pick<StepsRead, 'options'>, setup?: SessionSetup): RunRead {
    const page = readStepsResult(spec, url, result);
    const named = (fields: FieldResult[]) => {
        const attributes: RunRead['attributes'] = {};
        const fieldStatus: RunRead['fieldStatus'] = {};
        for (const f of fields) {
            attributes[f.name] = f.value;
            fieldStatus[f.name] = !f.filled ? 'empty' : f.ok ? 'ok' : 'check_failed';
        }
        return { attributes, fieldStatus };
    };
    const { attributes, fieldStatus } = named(page.fields);
    // Each item's row: the page's fields, with that item's values for the fields it repeats.
    const rows = page.options?.map(o => {
        const own = named(o.fields);
        return { option: { step: o.step, value: o.label }, attributes: { ...attributes, ...own.attributes }, fieldStatus: { ...fieldStatus, ...own.fieldStatus } };
    });
    const owner = new Map([
        ...spec.steps.flatMap(s => s.kind === 'field'
            ? s.field.ways.map((w, i) => [wayId(w, s.field.id, i), s.field.name] as const)
            : s.click.ways.map((w, i) => [wayId(w, s.click.id, i), `click: ${s.click.name}`] as const)),
        ...setupOwners(setup).flatMap(o => o.ways.map((w, i) => [wayId(w, o.key, i), o.name] as const)),
    ]);
    return {
        attributes, fieldStatus,
        ways: result.ways.map(w => ({ field: owner.get(w.wayId) ?? '', ...w })),
        filled: page.fields.filter(f => f.filled).length,
        total: page.fields.length,
        ...(rows ? { rows } : {}),
    };
}

/** What a job runs: the version's page recipe, its list recipe, or, for a details job, its details page. */
export function partOf(spec: ProSpec, job: CrawlJob): { page: PageRecipeSpec } | { list: ListRecipeSpec } {
    if (job.part === 'details') {
        if (spec.kind !== 'list' || !spec.details) throw new CrawlError('no_recipe', 'A details job, but the version has no details page.');
        return { page: spec.details.spec };
    }
    return spec.kind === 'page' ? { page: spec } : { list: spec };
}

export interface ListRows {
    /** Per list and row: field name → value, and which fields were empty. */
    rows: { listId: string; index: number; attributes: Record<string, string>; fieldStatus: Record<string, 'ok' | 'empty'> }[];
}

/** Rows named by their columns, every column present (empty when the row had none). */
export function readListRows(spec: ListRecipeSpec, lists: ListPageResult['lists']): ListRows {
    const rows: ListRows['rows'] = [];
    for (const l of lists) {
        const target = spec.lists.find(t => t.id === l.id);
        const columns = (target?.fields ?? []).filter(c => !c.hidden);
        l.rows.forEach((row, index) => {
            const attributes: Record<string, string> = {};
            const fieldStatus: Record<string, 'ok' | 'empty'> = {};
            for (const c of columns) {
                const v = row[c.id];
                attributes[c.name] = v ?? '';
                fieldStatus[c.name] = v ? 'ok' : 'empty';
            }
            rows.push({ listId: l.id, index, attributes, fieldStatus });
        });
    }
    return { rows };
}

/** The jobs a list page leads to: its next page (by link), and each row's details page. */
export function followUps(job: CrawlJob, spec: ListRecipeSpec, ref: RecipeRef, read: { lists: ListPageResult['lists']; nextHref?: string },
    o: { maxPages: number; details: boolean }): CrawlJob[] {
    const out: CrawlJob[] = [];
    const page = job.page ?? 1;
    const inherit = { competitor: job.competitor, pageType: job.pageType, ...(job.mode ? { mode: job.mode } : {}), ...(job.runId ? { runId: job.runId } : {}), ...(job.meta ? { meta: job.meta } : {}), ...(job.context ? { context: job.context } : {}) };
    const root = job.jobId.replace(/~p\d+$/, '');
    if (read.nextHref && page < o.maxPages) {
        // The same version for every page of one list, so a list is read with one recipe throughout.
        out.push({ jobId: `${root}~p${page + 1}`, url: read.nextHref, ...inherit, recipeDigest: ref.digest, page: page + 1 });
    }
    if (o.details && spec.details) {
        for (const l of read.lists) {
            if (!spec.lists.find(t => t.id === l.id)?.fields.some(c => c.id === spec.details!.urlColumn)) continue;
            // One details job per page: two rows linking to one product share it (the first row's).
            const seen = new Set<string>();
            l.rows.forEach((row, index) => {
                const raw = row[spec.details!.urlColumn]?.trim();
                let url: string;
                try { url = new URL(raw ?? '', job.url).href; } catch { return; }
                if (!raw || !/^https?:/i.test(url) || seen.has(url.split('#')[0])) return;
                seen.add(url.split('#')[0]);
                out.push({ jobId: `${job.jobId}~d${l.id}.${index}`, url, ...inherit, recipeDigest: ref.digest, part: 'details', parent: { jobId: job.jobId, listId: l.id, row: index } });
            });
        }
    }
    return out;
}
