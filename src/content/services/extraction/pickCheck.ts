/**
 * The pick check (`docs/plans/list-extraction-reliability-plan.md` L6): after a pick, the list is
 * compared with what the page says about its results ("1–24 of 7,047 results", "Showing 24 of 120",
 * "18 items"). A list far smaller than what the page shows is most likely one row of a grid, or a
 * shelf beside the results.
 */

/** Short texts that state a results count. */
const RANGE = /(\d[\d,]*)\s*[-–—]\s*(\d[\d,]*)\s+of\s+(?:over\s+|about\s+|more than\s+)?(\d[\d,]*)\+?\s+(results|items|products|listings)/i;
const SHOWING = /showing\s+(\d[\d,]*)\s+(?:of|out of)\s+(\d[\d,]*)/i;
const TOTAL = /^\(?\s*(\d[\d,]*)\+?\s*\)?\s+(results|items|products|listings)\b/i;

const num = (s: string) => Number(s.replace(/,/g, ''));

/** What the page says it shows on this page, and in all. */
export function statedCount(doc: Document = document): { shown?: number; total?: number } | undefined {
    for (const el of Array.from(doc.body?.querySelectorAll('h1, h2, h3, p, span, div, [aria-live], [role="status"]') ?? [])) {
        // Leaf-ish short texts only: a count is a phrase, not a paragraph.
        if (el.children.length > 6) continue;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length === 0 || text.length > 80) continue;
        let m = RANGE.exec(text);
        if (m) return { shown: num(m[2]) - num(m[1]) + 1, total: num(m[3]) };
        m = SHOWING.exec(text);
        if (m) return { shown: num(m[1]), total: num(m[2]) };
        m = TOTAL.exec(text);
        if (m) return { total: num(m[1]) };
    }
    return undefined;
}

/** Sentences for the review step when the list looks smaller than the page's results. */
export function pickProblems(items: number, doc: Document = document): string[] {
    const stated = statedCount(doc);
    if (!stated) return [];
    // A total alone says how many this page shows only when it is small enough to fit on one page.
    const shown = stated.shown ?? (stated.total !== undefined && stated.total <= 60 ? stated.total : undefined);
    if (!shown || shown <= 2 || items >= shown * 0.5) return [];
    const of = stated.total !== undefined && stated.total !== shown ? ` (of ${stated.total.toLocaleString('en-US')})` : '';
    return [`This list has ${items} item${items === 1 ? '' : 's'}, but the page says it shows ${shown}${of}. It may be one row of the grid or a shelf beside the results: click an item in the main results, or pick the whole grid.`];
}
