import { ElementDefinition, ExtractionConfig } from './types';
import { ElementProcessor } from './processors/ElementProcessor';
import { buildPageRecord } from './processors/columnHelpers';
import type { StepResult } from '../../../shared/listing/stepStats';
import { hitFilled, type PageRule, type PageWay, type WayHit } from '../../../shared/types/ways';
import { firstRule, PageProbe, readWays } from './ways';

/**
 * How one recipe step went on this page (`docs/plans/page-extractor-background-plan.md` P1, P5). An element
 * with `ways` (Pro) is read way by way: `hits` holds what each way read, and its value is left to the caller.
 */
export type PageStep = StepResult & { error?: string; hits?: WayHit[] };

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Runs a Page Extractor recipe on this page, its steps in their order (a click, then what it
 * reveals, then the next click), into one record: scalars as fields, each list shaped by the list
 * output setting (nested, one row per item, or numbered columns). An element read right after a
 * click is waited for, since the click may still be loading it.
 */
export async function extractPage(elements: ElementDefinition[], config: ExtractionConfig) {
    const processor = new ElementProcessor(config);
    const probe = new PageProbe();
    // Pro's page rules: a page that is not what the recipe reads (gone, a block page) is not read.
    const rule = config?.pageRules?.length ? firstRule(config.pageRules as PageRule[], probe) : null;
    if (rule) return { ...buildPageRecord({}, [], config?.listOutput), steps: [] as PageStep[], rule };
    const columns: any[] = [];
    const data: Record<string, any> = {};
    const steps: PageStep[] = [];
    let afterClick = false;
    // Fields bound to the page's data are read first: a click is only needed for what they don't give.
    const fromData = new Map(elements.filter(e => !e.ways).map(e => [e.id, processor.fromData(e)] as const).filter(([, r]) => r !== null));
    const revealsOnlyData = (i: number) => {
        const next = elements.slice(i + 1);
        const until = next.findIndex(e => e.action === 'click');
        const revealed = (until < 0 ? next : next.slice(0, until));
        return revealed.length > 0 && revealed.every(e => fromData.has(e.id));
    };

    for (const [i, element] of elements.entries()) {
        if (element.action === 'click' && revealsOnlyData(i)) {
            steps.push({ id: element.id, name: element.name, action: 'click', status: 'skipped' });
            continue;
        }
        if (element.ways && element.action !== 'click') {
            const hits = readWays(element.ways as PageWay[], probe);
            data[element.id] = null;
            steps.push({ id: element.id, name: element.name, action: 'extract', status: hits.some(hitFilled) ? 'ok' : 'not-found', hits });
            continue;
        }
        const result = fromData.get(element.id) ?? await processor.processElement(element, { waitFor: afterClick && element.action !== 'click' });
        if (element.action === 'click') {
            steps.push({ id: element.id, name: element.name, action: 'click', status: result.step ?? 'not-found', ...(result.error ? { error: result.error } : {}) });
            afterClick = true;
            continue;
        }

        result.columns?.forEach((col: any) => {
            if (!columns.find(c => c.id === col.id)) columns.push(col);
        });

        if (!result.success || !result.data) {
            data[element.id] = null;
            steps.push({ id: element.id, name: element.name, action: 'extract', status: 'not-found', ...(result.error ? { error: result.error } : {}) });
            continue;
        }
        if (Array.isArray(result.data.items)) {
            data[element.id] = {
                __type: result.data.type === 'table' ? 'table' : 'list',
                items: result.data.items,
                columns: result.columns || result.data.columns || []
            };
        } else {
            // A scalar, or a table collapsed to JSON (plus its raw data).
            data[element.id] = result.data[element.id] ?? result.data.value ?? null;
            const rawKey = element.id + '__tabledata';
            if (result.data[rawKey] !== undefined) data[rawKey] = result.data[rawKey];
        }
        const value = data[element.id];
        steps.push({ id: element.id, name: element.name, action: 'extract', status: isEmpty(value?.items ?? value) ? 'empty' : result.fromData ? 'data' : result.healed ? 'healed' : 'ok' });
    }

    return { ...buildPageRecord(data, columns, config?.listOutput), steps };
}
