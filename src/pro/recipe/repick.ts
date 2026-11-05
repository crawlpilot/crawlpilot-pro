/**
 * A page recipe picked again in the Page Extractor, saved over the version it was opened from. The extractor knows
 * only what the public extension does: fields as elements (name, reader, selectors, page data) and plain clicks. What
 * Pro adds on top is kept from the base version for every field and step picked again:
 * - a field's output type, required flag, cleanup and markup ways;
 * - an action step's action, value, optional flag and "for each";
 * - the session setup.
 * The picked selectors and page data replace the base's. Fields and steps new in this pick come as picked; fields
 * the pick dropped are gone.
 */
import type { ListRecipeSpec, PageRecipeSpec, Step } from './types';

export function keepFromBase(picked: PageRecipeSpec, base: PageRecipeSpec | undefined): PageRecipeSpec {
    if (!base) return picked;
    const fields = new Map(base.steps.flatMap(s => s.kind === 'field' ? [[s.field.id, s.field] as const] : []));
    const clicks = new Map(base.steps.flatMap(s => s.kind === 'click' ? [[s.click.id, s.click] as const] : []));
    const steps: Step[] = picked.steps.map(s => {
        if (s.kind === 'field') {
            const was = fields.get(s.field.id);
            if (!was) return s;
            const markup = was.ways.filter(w => w.kind === 'markup');
            return { kind: 'field', field: { ...was, name: s.field.name, read: s.field.read, ways: [...markup, ...s.field.ways],
                ...(s.field.columns ? { columns: s.field.columns } : {}), ...(s.field.shape ? { shape: s.field.shape } : {}) } };
        }
        const was = clicks.get(s.click.id);
        return was ? { kind: 'click', click: { ...was, name: s.click.name, ways: s.click.ways } } : s;
    });
    return { ...picked, steps, ...(base.setup ? { setup: base.setup } : {}) };
}

/**
 * A list recipe picked again in the List Extractor, saved over the version it was opened from: the extractor holds
 * the lists and pagination; the page rules, the session setup and the details page (when the pick has none) are
 * kept from the base version.
 */
export function keepListExtras(picked: ListRecipeSpec, base: ListRecipeSpec | undefined): ListRecipeSpec {
    if (!base) return picked;
    return {
        ...picked,
        ...(base.rules ? { rules: base.rules } : {}),
        ...(base.setup ? { setup: base.setup } : {}),
        ...(!picked.details && base.details ? { details: base.details } : {}),
    };
}
