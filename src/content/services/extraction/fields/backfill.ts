/**
 * The page's own data behind the fields (`docs/plans/list-extraction-reliability-plan.md` L5): when
 * the rows' JSON items are found (by ID, URL or name), a JSON field with the same meaning as a DOM
 * field becomes that field's fallback reader. A row whose price block never rendered (a skeleton, a
 * lazy block below the fold) still gets its price, from the data the page rendered it from.
 *
 * Only when the two agree: on the rows where both have a value, the same number (or text) in ≥ 90%.
 */
import { onlyNumber } from './meaning';
import { readRow } from './read';
import { FieldReader, norm, ReaderColumn } from './types';

const MIN_SHARED = 2;

function same(a: string, b: string, numeric: boolean): boolean {
    if (!numeric) return norm(a) === norm(b);
    const x = onlyNumber(a);
    const y = onlyNumber(b);
    return !!x && !!y && Math.abs(x.n - y.n) < 0.005;
}

/** The DOM columns, each backed by the JSON column that means the same and agrees with it. */
export function backfill(dom: ReaderColumn[], json: ReaderColumn[], rows: Element[]): ReaderColumn[] {
    if (json.length === 0) return dom;
    const domItems = rows.map(r => readRow(r, dom));
    const jsonItems = rows.map(r => readRow(r, json));
    return dom.map(col => {
        const meaning = col.reader?.meaning;
        if (!meaning || col.reader?.json) return col;
        const numeric = col.type === 'price' || col.type === 'number';
        const source = json.find(j => {
            if (j.reader?.meaning !== meaning) return false;
            let shared = 0;
            let agree = 0;
            domItems.forEach((d, i) => {
                const a = d[col.id];
                const b = jsonItems[i][j.id];
                if (!a || !b) return;
                shared++;
                if (same(a, b, numeric)) agree++;
            });
            return shared >= MIN_SHARED && agree >= shared * 0.9;
        });
        if (!source?.reader) return col;
        const { alternates: _, meaning: _m, expect: _e, ...reader } = source.reader as FieldReader;
        return { ...col, reader: { ...col.reader!, alternates: [...(col.reader!.alternates ?? []), reader] } };
    });
}
