/**
 * A recipe version as the in-page script runs it, and its result read back the way Pro's own tests read
 * it: `toPageSpec` makes the extractor's elements, `readPageResult` cleans and checks each field. So a page
 * gives the same values here as in Test on this page. Page recipes only, for now.
 */
import { toPageSpec } from '../recipe/fromPublic';
import type { ProSpec, RunSettings, Way } from '../recipe/types';
import { readPageResult } from '../runner/testPage';
import { CrawlError } from './classify';
import type { InPageRequest, InPageResult, WayProbe } from './inPage';
import type { ScrapeDoc, SelectorUsageDoc } from './types';

const wayId = (way: Way, owner: string, i: number) => way.id ?? `${owner}:${i}`;

export function inPageRequest(spec: ProSpec, settings: RunSettings): InPageRequest {
    if (spec.kind !== 'page') throw new CrawlError('extraction', 'List recipes are not run by the worker yet.');
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
}

export function readRun(spec: ProSpec, url: string, result: InPageResult): RunRead {
    if (spec.kind !== 'page') throw new CrawlError('extraction', 'List recipes are not run by the worker yet.');
    const page = readPageResult(spec, url, result.item, result.steps);
    const attributes: RunRead['attributes'] = {};
    const fieldStatus: RunRead['fieldStatus'] = {};
    for (const f of page.fields) {
        attributes[f.name] = f.value;
        fieldStatus[f.name] = !f.filled ? 'empty' : f.ok ? 'ok' : 'check_failed';
    }
    const owner = new Map(spec.steps.flatMap(s => s.kind === 'field'
        ? s.field.ways.map((w, i) => [wayId(w, s.field.id, i), s.field.name] as const)
        : s.click.ways.map((w, i) => [wayId(w, s.click.id, i), `click: ${s.click.name}`] as const)));
    return {
        attributes, fieldStatus,
        ways: result.ways.map(w => ({ field: owner.get(w.wayId) ?? '', ...w })),
        filled: page.fields.filter(f => f.filled).length,
        total: page.fields.length,
    };
}
