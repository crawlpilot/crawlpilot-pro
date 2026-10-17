/** Stage 2: group the rows' values by signature into fields, each with a row-relative selector. */
import { alignToTemplate, Atom, AtomAttr, isAtomRoot, readValue, Shape, shapeOf } from '../atoms';
import { nodeStep } from '../nodeName';
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
 */
function selectorFor(group: Group, rowAtoms: Map<Element, Atom[]>[], rows: Element[]): string {
    const sample = [...group.perRow.values()][0][0];
    const path = sample.path;
    if (path.length === 0) return ':scope';
    const leaf = nodeStep(path[path.length - 1]).label;
    const full = `:scope > ${stepsCss(path, 0)}`;

    const candidates = path.map((_, i) => stepsCss(path, path.length - 1 - i));
    candidates.push(full);
    for (const candidate of candidates) {
        let ok = true;
        for (let r = 0; r < rows.length && ok; r++) {
            const matched = query(rows[r], candidate);
            const own = group.perRow.get(r);
            // A match that reads nothing (an inline piece inside another value, an empty node) is harmless.
            const reads = (el: Element) => isAtomRoot(el, rows[r], group.attr) && readValue(el, group.attr) !== '';
            if (own) {
                const want = new Set(own.map(a => a.el));
                ok = own.every(a => matched.includes(a.el)) && matched.every(el => want.has(el) || !reads(el));
            } else {
                ok = matched.every(el => !reads(el) || (rowAtoms[r].get(el) ?? []).some(a =>
                    a.attr === group.attr && nodeStep(a.el).label === leaf));
            }
        }
        if (ok) return candidate;
    }
    return full;
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

/** Splits a group into fields: one, one per slot (aligned by shape), or one "many" field. */
function fieldsOf(group: Group, selector: string, docOrder: Map<Element, number>): Field[] {
    const firstOrder = (atoms: Atom[]) => Math.min(...atoms.map(a => docOrder.get(a.el) ?? 1e9));
    const many = group.maxCount > (MANY_THRESHOLD[group.attr] ?? 99);

    if (group.maxCount === 1 || many) {
        const values = new Map<number, string>();
        const atoms: Atom[] = [];
        group.perRow.forEach((list, r) => {
            atoms.push(...list);
            values.set(r, many ? list.map(a => a.value).join('; ') : list[0].value);
        });
        return [{
            key: `${selector}@${group.attr}`, attr: group.attr, selector, many: many || undefined,
            values, atoms, shape: mode(atoms.map(a => shapeOf(a.value, a.attr))), order: firstOrder(atoms),
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
        b.values.size - a.values.size || ATTR_RANK[a.attr] - ATTR_RANK[b.attr] || a.order - b.order);
}
