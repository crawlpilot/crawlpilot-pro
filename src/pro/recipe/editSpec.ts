/**
 * Edits to a page recipe's spec, each returning a new spec (the editor keeps the old one for undo-free
 * compare). Page data stays the first way: the extractor reads it before any selector.
 */
import type { Click, Field, FieldType, PageRecipeSpec, SessionSetup, Step } from './types';
import type { ProOp } from './ops';

const mapField = (spec: PageRecipeSpec, id: string, f: (field: Field) => Field): PageRecipeSpec => ({
    ...spec,
    steps: spec.steps.map(s => s.kind === 'field' && s.field.id === id ? { kind: 'field', field: f(s.field) } : s),
});

const move = <T,>(list: T[], from: number, to: number): T[] => {
    if (to < 0 || to >= list.length || from === to) return list;
    const next = [...list];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
};

export const renameField = (spec: PageRecipeSpec, id: string, name: string) => mapField(spec, id, f => ({ ...f, name }));
export const setFieldType = (spec: PageRecipeSpec, id: string, type: FieldType) => mapField(spec, id, f => ({ ...f, type }));
export const setRequired = (spec: PageRecipeSpec, id: string, required: boolean) =>
    mapField(spec, id, ({ required: _, ...f }) => required ? { ...f, required: true } : f);
export const setOps = (spec: PageRecipeSpec, id: string, ops: ProOp[]) => mapField(spec, id, f => ({ ...f, ops }));

export const removeStep = (spec: PageRecipeSpec, index: number): PageRecipeSpec => ({ ...spec, steps: spec.steps.filter((_, i) => i !== index) });
export const moveStep = (spec: PageRecipeSpec, index: number, delta: number): PageRecipeSpec => ({ ...spec, steps: move<Step>(spec.steps, index, index + delta) });

/** Moves a selector among the selectors; the page-data way never moves. */
export const moveWay = (spec: PageRecipeSpec, id: string, index: number, delta: number) => mapField(spec, id, f => {
    const firstSelector = f.ways.findIndex(w => w.kind === 'selector');
    const to = index + delta;
    if (f.ways[index]?.kind !== 'selector' || to < firstSelector) return f;
    return { ...f, ways: move(f.ways, index, to) };
});
export const removeWay = (spec: PageRecipeSpec, id: string, index: number) => mapField(spec, id, f => ({ ...f, ways: f.ways.filter((_, i) => i !== index) }));
export const addSelector = (spec: PageRecipeSpec, id: string, selector: string) => mapField(spec, id, f => {
    const s = selector.trim();
    if (!s || f.ways.some(w => w.kind === 'selector' && w.selector === s)) return f;
    return { ...f, ways: [...f.ways, { kind: 'selector', selector: s }] };
});

/** A page step that acts (a click or another action), changed. */
export const updateClick = (spec: PageRecipeSpec, id: string, f: (c: Click) => Click): PageRecipeSpec => ({
    ...spec,
    steps: spec.steps.map(s => s.kind === 'click' && s.click.id === id ? { kind: 'click', click: f(s.click) } : s),
});

/** A new action step, at the end of the page's steps (moved into place from there). */
export const addAction = (spec: PageRecipeSpec, click: Click): PageRecipeSpec => ({ ...spec, steps: [...spec.steps, { kind: 'click', click }] });

/** The session setup, changed; an empty one is dropped, so a recipe without it keeps its digest. */
export function editSetup(spec: PageRecipeSpec, f: (s: SessionSetup) => SessionSetup): PageRecipeSpec {
    const next = f(spec.setup ?? { steps: [] });
    const { setup: _, ...rest } = spec;
    const empty = next.steps.length === 0 && !next.check && !next.dismiss?.length;
    const tidy: SessionSetup = { steps: next.steps, ...(next.dismiss?.length ? { dismiss: next.dismiss } : {}), ...(next.check ? { check: next.check } : {}) };
    return empty ? rest : { ...rest, setup: tidy };
}

/** A list's item moved, replaced or removed: for the setup's steps and dismissals. */
export const listEdit = {
    move: <T,>(list: T[], index: number, delta: number) => move(list, index, index + delta),
    replace: <T,>(list: T[], index: number, item: T) => list.map((x, i) => i === index ? item : x),
    remove: <T,>(list: T[], index: number) => list.filter((_, i) => i !== index),
};

/** What stops a save: one line each. */
export function problems(spec: PageRecipeSpec): string[] {
    const fields = spec.steps.flatMap(s => s.kind === 'field' ? [s.field] : []);
    const out: string[] = [];
    if (fields.length === 0) out.push('The recipe has no fields.');
    const names = fields.map(f => f.name.trim());
    if (names.some(n => !n)) out.push('Every field needs a name.');
    const dupes = [...new Set(names.filter((n, i) => n && names.indexOf(n) !== i))];
    if (dupes.length) out.push(`Two fields are named ${dupes.map(d => `"${d}"`).join(', ')}.`);
    for (const f of fields) if (f.ways.length === 0) out.push(`"${f.name || 'A field'}" has no way to find it.`);
    for (const s of spec.steps) if (s.kind === 'click') out.push(...actionProblems(s.click));
    const repeating = spec.steps.filter(s => s.kind === 'click' && s.click.forEach);
    if (repeating.length > 1) out.push('Only one step can go through each item.');
    for (const c of spec.setup?.steps ?? []) out.push(...actionProblems(c, 'Setup step'));
    for (const c of spec.setup?.dismiss ?? []) if (c.ways.length === 0) out.push(`Dismiss "${c.name}" has nothing to click.`);
    if (spec.setup?.check && !spec.setup.check.contains.trim()) out.push('The setup check needs the text it must contain.');
    if (spec.setup?.check && spec.setup.check.ways.length === 0) out.push('The setup check has no element to read.');
    return out;
}

/** What an action step lacks: a target (scrolling to the end needs none), or the value its kind needs. */
export function actionProblems(c: Click, label = 'Step'): string[] {
    const name = `${label} "${c.name}"`;
    const what = c.do ?? 'click';
    const out: string[] = [];
    if (c.ways.length === 0 && what !== 'scroll' && what !== 'press') out.push(what === 'click' ? `Click "${c.name}" has nothing to click.` : `${name} has no element to act on.`);
    if ((what === 'type' || what === 'select' || what === 'press') && !c.value?.trim()) out.push(`${name} needs a value to ${what}.`);
    if (what === 'choose' && !c.forEach && !c.value?.trim() && c.index === undefined) out.push(`${name} needs the text to choose, or which item.`);
    if (c.forEach && what !== 'choose') out.push(`${name} goes through each item, so it must choose from a list.`);
    return out;
}
