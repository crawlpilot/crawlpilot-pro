import { ElementDefinition, ExtractionConfig } from './types';
import { ElementProcessor } from './processors/ElementProcessor';
import { buildPageRecord } from './processors/columnHelpers';

/** How one recipe step went on this page (`docs/plans/page-extractor-background-plan.md` P1, P5). */
export interface PageStep {
    id: string;
    name: string;
    action: 'extract' | 'click';
    /** `data`: read from the page's data; `skipped`: a click whose fields all came from data. */
    status: 'ok' | 'data' | 'empty' | 'not-found' | 'clicked' | 'already-open' | 'opened' | 'no-effect' | 'skipped';
    error?: string;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Runs a Page Extractor recipe on this page, its steps in their order (a click, then what it
 * reveals, then the next click), into one record: scalars as fields, each list shaped by the list
 * output setting (nested, one row per item, or numbered columns). An element read right after a
 * click is waited for, since the click may still be loading it.
 */
export async function extractPage(elements: ElementDefinition[], config: ExtractionConfig) {
    const processor = new ElementProcessor(config);
    const columns: any[] = [];
    const data: Record<string, any> = {};
    const steps: PageStep[] = [];
    let afterClick = false;
    // Fields bound to the page's data are read first: a click is only needed for what they don't give.
    const fromData = new Map(elements.map(e => [e.id, processor.fromData(e)] as const).filter(([, r]) => r !== null));
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
        steps.push({ id: element.id, name: element.name, action: 'extract', status: isEmpty(value?.items ?? value) ? 'empty' : result.fromData ? 'data' : 'ok' });
    }

    return { ...buildPageRecord(data, columns, config?.listOutput), steps };
}
