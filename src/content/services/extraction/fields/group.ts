/** Stage 2: group the rows' values by signature into fields, each with a row-relative selector. */
import { labelValue, alignToTemplate, Atom, AtomAttr, isAtomRoot, readValue, Shape, shapeOf } from '../atoms';
import { nodeStep } from '../nodeName';
import { AUTHOR_ATTRIBUTES } from '../../../../shared/selectors/stability';
import { Field, mode, query } from './types';

const MANY_THRESHOLD: Partial<Record<AtomAttr, number>> = { src: 1, href: 2, text: 5, own: 5 };
const ATTR_RANK: Record<AtomAttr, number> = { text: 0, own: 1, cell: 0, datetime: 2, href: 3, src: 4, 'aria-label': 5, title: 6 };

interface Group {
    sig: string;
    attr: AtomAttr;
    /** Per sampled row: this signature's atoms in document order. */
    perRow: Map<number, Atom[]>;
    maxCount: number;
}

function stepsCss(path: Element[], from: number): string {
    return path.slice(from).map(e => nodeStep(e).css).join(' > ');
}

/**
 * The shortest row-relative selector for a signature: in rows that have it, it must match exactly
 * the signature's elements; in rows that don't, it may only match the same kind of node (the same
 * leaf in a sponsored card's extra wrapper), never something else. So variant cards share one
 * selector, and one column, instead of producing a column each that someone merges later.
 *
 * A leaf with nothing stable of its own (a `<span>` with a hashed class) next to siblings that have
 * hooks (`<span data-testid="product-reviews">`) gets them excluded (`span:not([data-testid])`), or
 * else its position among its siblings. A column's selector reads one thing: when none is unique,
 * the signature gets no field (null) rather than one that reads another element on a run.
 */
function selectorFor(group: Group, rowAtoms: Map<Element, Atom[]>[], rows: Element[]): string | null {
    const sample = [...group.perRow.values()][0][0];
    const path = sample.path;
    if (path.length === 0) return ':scope';
    const leaf = nodeStep(path[path.length - 1]).label;
    const full = `:scope > ${stepsCss(path, 0)}`;

    /** The elements `candidate` matches that read a value and are not this signature's; [] when it is exact. */
    const strays = (candidate: string): Element[] => {
        const out: Element[] = [];
        rows.forEach((row, r) => {
            const matched = query(row, candidate);
            const own = group.perRow.get(r);
            // A match that reads nothing (an inline piece inside another value, an empty node) is harmless.
            // Labels count as values only where `labelValue` says so (the star link's "4.5 out of 5 stars, rating details" doesn't).
            const reads = (el: Element) => isAtomRoot(el, row, group.attr)
                && (group.attr === 'aria-label' || group.attr === 'title' ? labelValue(el, group.attr) !== '' : readValue(el, group.attr) !== '');
            if (own) {
                const want = new Set(own.map(a => a.el));
                // A missed own element can't be excluded: it counts as the candidate's own stray.
                if (!own.every(a => matched.includes(a.el))) out.push(row);
                matched.forEach(el => { if (!want.has(el) && reads(el)) out.push(el); });
            } else {
                matched.forEach(el => {
                    if (reads(el) && !(rowAtoms[r].get(el) ?? []).some(a => a.attr === group.attr && nodeStep(a.el).label === leaf)) out.push(el);
                });
            }
        });
        return out;
    };

    const candidates = path.map((_, i) => stepsCss(path, path.length - 1 - i));
    candidates.push(full);
    for (const candidate of candidates) if (strays(candidate).length === 0) return candidate;

    const ownEls = [...group.perRow.values()].flat().map(a => a.el);
    for (const candidate of candidates) {
        const wrong = strays(candidate);
        if (wrong.some(el => rows.includes(el))) continue;
        for (const narrowed of [...exclusions(wrong, ownEls), ...positions(ownEls)]) {
            if (strays(candidate + narrowed).length === 0) return candidate + narrowed;
        }
    }
    return null;
}

/**
 * `:not(…)` suffixes that drop the stray matches by their own stable steps: by an attribute none of
 * the signature's elements has (`:not([data-testid])`, which also drops a sibling hook a later page
 * adds), else by each stray's step.
 */
function exclusions(wrong: Element[], own: Element[]): string[] {
    const out: string[] = [];
    for (const attr of AUTHOR_ATTRIBUTES) {
        if (wrong.every(el => el.hasAttribute(attr)) && !own.some(el => el.hasAttribute(attr))) out.push(`:not([${attr}])`);
    }
    const steps = [...new Set(wrong.map(el => nodeStep(el).css))];
    const ownSteps = new Set(own.map(el => nodeStep(el).css));
    if (steps.every(css => !ownSteps.has(css))) out.push(steps.map(css => `:not(${css})`).join(''));
    return out;
}

/** The leaf's position among its same-tag siblings, when it is the same in every row. */
function positions(own: Element[]): string[] {
    const index = (el: Element) => Array.from(el.parentElement?.children ?? []).filter(c => c.tagName === el.tagName).indexOf(el) + 1;
    const at = new Set(own.map(index));
    return at.size === 1 ? [`:nth-of-type(${[...at][0]})`] : [];
}

function groupsOf(rowsAtoms: Atom[][]): Group[] {
    const bySig = new Map<string, Group>();
    rowsAtoms.forEach((atoms, r) => {
        for (const a of atoms) {
            let g = bySig.get(a.sig);
            if (!g) { g = { sig: a.sig, attr: a.attr, perRow: new Map(), maxCount: 0 }; bySig.set(a.sig, g); }
            const list = g.perRow.get(r) ?? [];
            list.push(a);
            g.perRow.set(r, list);
            g.maxCount = Math.max(g.maxCount, list.length);
        }
    });
    return [...bySig.values()];
}

/**
 * Same-kind siblings whose number changes from card to card (colour swatches: 3 on one card, 6 on
 * the next) are one list, not a column per position: slot 4 would be "Pink" on one card and
 * "Skye" on another. A fixed set of siblings (brand, then colour) stays split by slot.
 */
function isList(group: Group): boolean {
    if (group.maxCount < 3) return false;
    const lists = [...group.perRow.values()];
    const counts = new Set(lists.filter(l => l.length > 1).map(l => l.length));
    if (counts.size < 2) return false;
    const shapes = new Set(lists.flat().map(a => shapeOf(a.value, a.attr)));
    return shapes.size === 1;
}

/** Splits a group into fields: one, one per slot (aligned by shape), or one "many" field. */
function fieldsOf(group: Group, selector: string, docOrder: Map<Element, number>): Field[] {
    const firstOrder = (atoms: Atom[]) => Math.min(...atoms.map(a => docOrder.get(a.el) ?? 1e9));
    const many = group.maxCount > (MANY_THRESHOLD[group.attr] ?? 99) || isList(group);

    if (group.maxCount === 1 || many) {
        const values = new Map<number, string>();
        const atoms: Atom[] = [];
        group.perRow.forEach((list, r) => {
            atoms.push(...list);
            // As a run reads it (`read.ts`): links and images a JSON array, text joined.
            const uniq = [...new Set(list.map(a => a.value))];
            values.set(r, !many ? list[0].value : group.attr === 'src' || group.attr === 'href' ? JSON.stringify(uniq) : uniq.join('; '));
        });
        const field: Field = {
            key: `${selector}@${group.attr}`, attr: group.attr, selector, many: many || undefined,
            values, atoms, shape: mode(atoms.map(a => shapeOf(a.value, a.attr))), order: firstOrder(atoms),
        };
        if (!many || group.attr !== 'src') return [field];
        // A gallery also gives the card's main image, its first: most exports want one per row. A
        // single image field elsewhere in the card that reads the same is merged into it later.
        const first = new Map<number, string>();
        group.perRow.forEach((list, r) => first.set(r, list[0].value));
        return [field, {
            key: `${selector}@src#first`, attr: 'src', selector, first: true, values: first,
            atoms: [...group.perRow.values()].map(l => l[0]), shape: field.shape, order: field.order - 0.5,
        }];
    }

    // Repeated nodes: the template is the per-slot shape of the rows that have them all.
    const full = [...group.perRow.values()].filter(l => l.length === group.maxCount);
    const template: Shape[] = [];
    for (let s = 0; s < group.maxCount; s++) template.push(mode(full.map(l => shapeOf(l[s].value, l[s].attr))));

    const slots: Field[] = template.map((shape, slot) => ({
        key: `${selector}@${group.attr}#${slot}`, attr: group.attr, selector, slot, template,
        values: new Map(), atoms: [], shape, order: 0,
    }));
    group.perRow.forEach((list, r) => {
        const assigned = alignToTemplate(list.map(a => shapeOf(a.value, a.attr)), template);
        assigned.forEach((slot, i) => {
            if (slot < 0 || slots[slot].values.has(r)) return;
            slots[slot].values.set(r, list[i].value);
            slots[slot].atoms.push(list[i]);
        });
    });
    return slots.filter(f => f.atoms.length > 0).map(f => ({ ...f, order: firstOrder(f.atoms) }));
}

/** The candidate fields of the item rows, best first: most rows, then the better attribute, then reading order. */
export function groupFields(rows: Element[], rowsAtoms: Atom[][]): Field[] {
    const rowAtoms = rowsAtoms.map(atoms => {
        const m = new Map<Element, Atom[]>();
        atoms.forEach(a => { const l = m.get(a.el) ?? []; l.push(a); m.set(a.el, l); });
        return m;
    });
    const docOrder = new Map<Element, number>();
    rowsAtoms.forEach(atoms => atoms.forEach((a, i) => { if (!docOrder.has(a.el)) docOrder.set(a.el, i); }));

    const byKey = new Map<string, Field>();
    for (const group of groupsOf(rowsAtoms)) {
        const selector = selectorFor(group, rowAtoms, rows);
        if (selector === null) continue;
        for (const f of fieldsOf(group, selector, docOrder)) {
            const existing = byKey.get(f.key);
            if (existing) {
                f.values.forEach((v, r) => { if (!existing.values.has(r)) existing.values.set(r, v); });
                existing.atoms.push(...f.atoms);
                existing.order = Math.min(existing.order, f.order);
            } else {
                byKey.set(f.key, f);
            }
        }
    }
    return [...byKey.values()].sort((a, b) =>
        b.values.size - a.values.size || (ATTR_RANK[a.attr] ?? 7) - (ATTR_RANK[b.attr] ?? 7) || a.order - b.order);
}
