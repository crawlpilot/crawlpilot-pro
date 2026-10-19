/**
 * Checks and heal (`docs/plans/generic-list-selectors-plan.md` §4, §5): every page of a run is read
 * with the fields frozen at the pick, and every page is checked against what they looked like then.
 *
 * - A field whose fill or parse rate falls by more than 30 points is **healed by meaning**: the
 *   fields are inferred again on this page's rows and the one with the same meaning and type takes
 *   over (the broken reader stays as an alternate, for pages that still have the old layout).
 * - When the row gate itself no longer fits (a redesign renamed the card's classes), the new
 *   inference's gate replaces it.
 * - A field nothing on the page means is reported broken; its cells stay empty.
 *
 * And readiness: a row still loading (a skeleton, a busy marker, an empty element where nearly every
 * card had a value) is read again after the page settles.
 */
import { collectAtoms, withAtomCache } from '../atoms';
import { inferFields } from '.';
import { parses } from './parse';
import { readRow } from './read';
import { FieldReader, query, ReaderColumn } from './types';

/** Points a rate may fall before the field counts as broken. */
const DROP = 0.3;
const MIN_ROWS = 3;

export interface PageHealth {
    /** The columns to read this page and the next with: the same array when nothing broke. */
    columns: ReaderColumn[];
    /** Names of the fields found again by their meaning. */
    healed: string[];
    /** Names of the fields that read nothing like before, and could not be found again. */
    broken: string[];
}

const has = (v: unknown) => v !== undefined && v !== '';

/** Fill and parse rates of `col` over rows read with it. */
function rates(items: Record<string, string>[], col: ReaderColumn): { fill: number; parse: number } {
    const values = items.map(i => i[col.id]).filter(has);
    return {
        fill: items.length ? values.length / items.length : 0,
        parse: values.length ? values.filter(v => parses(v, col.type)).length / values.length : 1,
    };
}

function isBroken(items: Record<string, string>[], col: ReaderColumn): boolean {
    const e = col.reader?.expect;
    if (!e || e.fill < DROP) return false;
    const now = rates(items, col);
    return now.fill < e.fill - DROP || (e.parse !== undefined && now.parse < e.parse - DROP);
}

/** The reader without its alternates, to keep as one. */
function asAlternate(r: FieldReader): Omit<FieldReader, 'alternates'> {
    const { alternates: _, meaning: _m, expect: _e, ...rest } = r;
    return rest;
}

/** Checks a page's rows against the fields' expectations and heals what broke. */
export function checkPage(rows: Element[], columns: ReaderColumn[]): PageHealth {
    const unchanged = { columns, healed: [], broken: [] };
    const ready = rows.filter(r => !isPending(r, columns) && collectAtoms(r).length > 0);
    if (ready.length < MIN_ROWS || !columns.some(c => c.reader?.expect)) return unchanged;
    return withAtomCache(() => {
        const items = ready.map(r => readRow(r, columns));
        const read = items.filter(i => Object.keys(i).length > 0);
        // The gate turns most rows away: the cards changed, every field is read from a new inference.
        const gateBroken = read.length < ready.length * 0.5;
        const broken = columns.filter(c => (gateBroken ? !!c.reader?.expect && c.reader.expect.fill >= DROP : isBroken(read, c)));
        if (broken.length === 0) return unchanged;

        const inferred = inferFields(ready).columns;
        const gate = inferred.find(c => c.reader?.rowGate)?.reader?.rowGate;
        const healed: string[] = [];
        const lost: string[] = [];
        const next = columns.map(col => {
            const reader = col.reader!;
            const withGate = (r: FieldReader): FieldReader => {
                if (!gateBroken) return r;
                const { rowGate: _, ...rest } = r;
                return gate ? { ...rest, rowGate: gate } : rest;
            };
            if (!broken.includes(col)) return reader ? { ...col, reader: withGate(reader) } : col;
            // The same meaning and type on this page, the best filled.
            const candidates = inferred.filter(c => c.reader && c.type === col.type && (reader.meaning ? c.reader.meaning === reader.meaning : c.name === col.name));
            let best: { c: ReaderColumn; fill: number } | undefined;
            for (const c of candidates) {
                const probe = { ...c, id: col.id };
                const fill = rates(ready.map(r => readRow(r, [probe])), probe).fill;
                if (!best || fill > best.fill) best = { c, fill };
            }
            if (!best || best.fill < (reader.expect?.fill ?? 0) - DROP) {
                lost.push(col.name);
                return { ...col, reader: withGate(reader) };
            }
            healed.push(col.name);
            const found = best.c.reader!;
            return {
                ...col,
                selector: best.c.selector,
                reader: withGate({
                    ...found,
                    meaning: reader.meaning,
                    expect: reader.expect,
                    // The old reader stays as a fallback: a later page may still have the old layout.
                    alternates: [...(found.alternates ?? []), asAlternate(reader), ...(reader.alternates ?? [])],
                }),
            };
        });
        return { columns: next, healed, broken: lost };
    });
}

/** Busy markers: the row or something in it is still loading. */
const BUSY = '[aria-busy="true"], [data-loading="true"]';
const BUSY_CLASS = /(^|[\s_-])(skeleton|shimmer|placeholder|loading)([\s_-]|$)/i;

/**
 * The row is still loading: it has a busy marker, or a field nearly every card had (≥ 90%) finds its
 * element here but the element is empty.
 */
export function isPending(row: Element, columns: ReaderColumn[] = []): boolean {
    if (row.matches(BUSY) || row.querySelector(BUSY)) return true;
    // A skeleton is an empty block with a loading class; a wrapper named "placeholder" that holds the
    // image or text is the loaded content, kept.
    const skeleton = (el: Element) => BUSY_CLASS.test(el.getAttribute('class') || '') && !(el.textContent || '').trim() && !el.querySelector('img, picture, video, svg');
    if (skeleton(row) || Array.from(row.querySelectorAll('[class]')).some(skeleton)) return true;
    return columns.some(c => {
        const r = c.reader;
        if (!r || !r.expect || r.expect.fill < 0.9 || r.json || r.cell || (r.attr !== 'text' && r.attr !== 'own')) return false;
        const els = r.chain[0] ? query(row, r.chain[0]) : [];
        return els.length > 0 && els.every(el => !(el.textContent || '').trim() && !el.querySelector('img, svg'));
    });
}

/**
 * Reads a row, and again after each `settle` while it is still loading, up to `tries` times; then as
 * it is (`pending` says it never finished).
 */
export async function readWhenReady(row: Element, columns: ReaderColumn[], settle: () => Promise<void>, tries = 3): Promise<{ item: Record<string, string>; pending: boolean }> {
    for (let i = 0; i < tries && isPending(row, columns); i++) await settle();
    return { item: readRow(row, columns), pending: isPending(row, columns) };
}
