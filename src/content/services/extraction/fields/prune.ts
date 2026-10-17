/**
 * Stage 4: drop boilerplate. One odd card, the same label on every card that has it ("See options",
 * "Ships to India", "List:"), tiny icons, descriptions made of other fields.
 */
import { Field, norm, TEXTUAL } from './types';

function alnum(s: string): number {
    return (s.match(/[\p{L}\p{N}]/gu) || []).length;
}

function avgLen(f: Field): number {
    let t = 0;
    f.values.forEach(v => { t += v.length; });
    return f.values.size ? t / f.values.size : 0;
}

/**
 * Removes, in place, fields whose value is mostly other fields' values glued together: after taking
 * out every other field's value found in it, little of its own is left (≤25%) in most rows.
 */
function dropComposites(fields: Field[]): void {
    const order = [...fields].sort((a, b) => avgLen(b) - avgLen(a));
    for (const a of order) {
        if (!TEXTUAL.has(a.attr) || a.many) continue;
        const others = fields.filter(f => f !== a && f.attr !== 'src' && f.attr !== 'href');
        let rows = 0;
        let composite = 0;
        a.values.forEach((value, r) => {
            const total = alnum(value);
            if (total === 0) return;
            rows++;
            let rest = norm(value);
            let found = 0;
            // Longest first, so "4.4 out of 5 stars" goes before a bare "4.4".
            others.map(o => o.values.get(r)).filter((v): v is string => !!v && alnum(v) >= 2)
                .map(norm).sort((x, y) => y.length - x.length)
                .forEach(v => { if (rest.includes(v)) { rest = rest.replace(v, ' '); found++; } });
            if (found > 0 && alnum(rest) <= Math.max(total * 0.25, 5)) composite++;
        });
        if (rows > 0 && composite / rows >= 0.8) fields.splice(fields.indexOf(a), 1);
    }
}

function isBoilerplate(f: Field, n: number): boolean {
    if (n >= 8 && f.values.size <= 1) return true;
    if (TEXTUAL.has(f.attr) && f.values.size >= Math.min(3, n) && n >= 3 && new Set([...f.values.values()].map(norm)).size === 1) return true;
    // Labels for the value next to them ("List:", "Price:").
    if (TEXTUAL.has(f.attr) && [...f.values.values()].every(v => /:\s*$/.test(v) && v.length < 30)) return true;
    if (f.attr === 'src') {
        const img = f.atoms[0].el as HTMLImageElement;
        const w = img.naturalWidth || Number(img.getAttribute('width')) || 0;
        const h = img.naturalHeight || Number(img.getAttribute('height')) || 0;
        if ((w > 0 && w < 32) || (h > 0 && h < 32)) return true;
    }
    return false;
}

/** The fields worth a column, out of `n` item rows. */
export function pruneFields(fields: Field[], n: number): Field[] {
    const kept = fields.filter(f => !isBoilerplate(f, n));
    dropComposites(kept);
    return kept;
}
