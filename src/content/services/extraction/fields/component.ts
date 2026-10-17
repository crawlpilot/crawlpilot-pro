/**
 * Stage 2b: repeated components. A site hook that occurs more than once in a card (Walmart's
 * `badgeTagComponent`: "Free shipping, arrives" + "in 3+ days", then "Pickup" + "tomorrow") is a
 * list of short sentences split over spans. Read per fragment it becomes a column per fragment and
 * position (Badge, Badge 2 … Badge 6, Date); read whole, it is one field: every occurrence's text,
 * joined.
 */
import { Atom, readValue, shapeOf } from '../atoms';
import { AUTHOR_ATTRIBUTES, isStableAttributeValue } from '../../../../shared/selectors/stability';
import { Field, TEXTUAL } from './types';

const MIN_ROWS_REPEATING = 2;

function cssAttr(attr: string, value: string): string {
    return `[${attr}="${value.replace(/["\\]/g, '\\$&')}"]`;
}

/** Author hooks (`attr="value"`) that occur at least twice in at least two rows. */
function repeatedHooks(rows: Element[]): string[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
        const perRow = new Map<string, number>();
        for (const attr of AUTHOR_ATTRIBUTES) {
            row.querySelectorAll(`[${attr}]`).forEach(el => {
                const value = el.getAttribute(attr)!;
                if (!isStableAttributeValue(attr, value)) return;
                const key = cssAttr(attr, value);
                perRow.set(key, (perRow.get(key) ?? 0) + 1);
            });
        }
        perRow.forEach((n, key) => { if (n >= 2) counts.set(key, (counts.get(key) ?? 0) + 1); });
    }
    return [...counts.entries()].filter(([, rowsWithRepeats]) => rowsWithRepeats >= MIN_ROWS_REPEATING).map(([key]) => key);
}

/**
 * Replaces the text fields that lie wholly inside a repeated hook, when they are its fragments (one
 * selector split into slots), with one field reading each occurrence whole (`cell`, every match a
 * value). Other fields are untouched.
 */
export function collapseComponents(fields: Field[], rows: Element[]): Field[] {
    let out = fields;
    for (const hook of repeatedHooks(rows)) {
        const inside = (f: Field) => TEXTUAL.has(f.attr) && f.atoms.length > 0 && f.atoms.every(a => a.el.closest(hook));
        const parts = out.filter(inside);
        // Fragments: one selector split into position slots. Distinct fields that merely share a
        // repeated wrapper (Amazon's reviews and badge inside `s-client-side-analytics`) stay apart.
        const slotsBySelector = new Map<string, number>();
        parts.filter(p => p.slot !== undefined).forEach(p => slotsBySelector.set(p.selector, (slotsBySelector.get(p.selector) ?? 0) + 1));
        if (![...slotsBySelector.values()].some(n => n >= 2)) continue;

        const values = new Map<number, string>();
        const atoms: Atom[] = [];
        rows.forEach((row, r) => {
            const found = Array.from(row.querySelectorAll(hook));
            const texts = found.map(el => readValue(el, 'cell')).filter(Boolean);
            if (texts.length === 0) return;
            values.set(r, texts.join('; '));
            found.forEach(el => atoms.push({ el, attr: 'cell', value: readValue(el, 'cell'), sig: `${hook}@cell`, path: [el] }));
        });
        const field: Field = {
            key: `${hook}@cell*`, attr: 'cell', selector: hook, many: true, values, atoms,
            shape: shapeOf(atoms[0]?.value ?? '', 'cell'), order: Math.min(...parts.map(p => p.order)),
        };
        out = [...out.filter(f => !inside(f)), field];
    }
    return out;
}
