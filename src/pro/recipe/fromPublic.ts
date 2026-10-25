/**
 * The boundary with the public recipe types: the only file that reads `PageSpec`, `ListSpec` and
 * `PageElement`, so an upstream change to them breaks here and nowhere else. `toPublic` turns a version
 * back into what the upstream `extractPage` runs.
 */
import type { ListSpec, PageElement, PageSpec } from '../../shared/types/database';
import type { Field, FieldType, ListRecipeSpec, PageRecipeSpec, ProSpec, RunSettings, Step, Way } from './types';

const LIST_READS = new Set(['text_array', 'link_array', 'image_array']);

/** A first guess at the output type from what is read; the type detector refines it later. */
function fieldType(e: PageElement): FieldType {
    if (e.data?.as === 'object') return 'object';
    if (e.data?.as === 'rows' || e.type === 'table' || e.type === 'list') return 'table';
    if (e.data?.as === 'list' || LIST_READS.has(e.type)) return 'list';
    if (e.type === 'link' || e.type === 'image' || e.shape === 'url' || e.shape === 'image') return 'url';
    if (e.shape === 'price') return 'money';
    if (e.shape === 'date') return 'date';
    return 'text';
}

/** Page data first, then the selectors in order: the order `ElementProcessor` tries them. */
function waysOf(e: PageElement): Way[] {
    return [
        ...(e.data ? [{ kind: 'data', binding: e.data } as const] : []),
        ...e.selectors.map(selector => ({ kind: 'selector', selector }) as const),
    ];
}

function stepOf(e: PageElement): Step {
    if (e.action === 'click') return { kind: 'click', click: { id: e.id, name: e.name, ways: waysOf(e) } };
    const field: Field = { id: e.id, name: e.name, type: fieldType(e), read: e.type, ways: waysOf(e), ops: [] };
    if (e.fields) field.columns = e.fields;
    if (e.shape) field.shape = e.shape;
    return { kind: 'field', field };
}

export function fromPageSpec(spec: PageSpec): { spec: PageRecipeSpec; settings: RunSettings } {
    return { spec: { kind: 'page', steps: spec.elements.map(stepOf) }, settings: { ...spec.settings } };
}

export function fromListSpec(spec: ListSpec): { spec: ListRecipeSpec; settings: RunSettings } {
    const { speed, ...pagination } = spec.pagination;
    const out: ListRecipeSpec = { kind: 'list', lists: spec.lists, pagination };
    if (spec.details) out.details = { spec: fromPageSpec(spec.details.page).spec, urlColumn: spec.details.urlColumn };
    return { spec: out, settings: speed ? { paginationSpeed: speed } : {} };
}

function elementOf(step: Step): PageElement {
    const ways = step.kind === 'field' ? step.field.ways : step.click.ways;
    const data = ways.find(w => w.kind === 'data')?.binding;
    const selectors = ways.flatMap(w => w.kind === 'selector' ? [w.selector] : []);
    if (step.kind === 'click') return { id: step.click.id, name: step.click.name, action: 'click', type: 'text', selectors };
    const { field } = step;
    const e: PageElement = { id: field.id, name: field.name, action: 'extract', type: field.read, selectors };
    if (field.columns) e.fields = field.columns;
    if (data) e.data = data;
    if (field.shape) e.shape = field.shape;
    return e;
}

/** A page version as the public extractor runs it. Page data is always tried before selectors there. */
export function toPageSpec(spec: PageRecipeSpec, settings: RunSettings): PageSpec {
    return { kind: 'page', elements: spec.steps.map(elementOf), settings: { ...settings } };
}

export function toListSpec(spec: ListRecipeSpec, settings: RunSettings): ListSpec {
    const speed = settings.paginationSpeed as ListSpec['pagination']['speed'];
    const out: ListSpec = { kind: 'list', lists: spec.lists, pagination: { ...spec.pagination, ...(speed ? { speed } : {}) } };
    if (spec.details) out.details = { page: toPageSpec(spec.details.spec, {}), urlColumn: spec.details.urlColumn };
    return out;
}

export function toPublic(spec: ProSpec, settings: RunSettings): PageSpec | ListSpec {
    return spec.kind === 'page' ? toPageSpec(spec, settings) : toListSpec(spec, settings);
}
