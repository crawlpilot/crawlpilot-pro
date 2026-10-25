/**
 * Every data table on the page (docs/plans/automation-and-page-tools-plan.md §3.5): HTML `<table>`s and
 * ARIA grids (`role="table"`/`"grid"` built from divs), each read into a header and rows of text.
 *
 * - **Merged cells:** `colspan` / `rowspan` are expanded, so every row has every column.
 * - **Header:** the `thead` rows, else the leading rows of only header cells (`th`, `columnheader`).
 *   Several header rows are joined per column ("Q1 › Revenue"). None: "Column 1", "Column 2"…
 * - **Links and images:** a column whose cells mostly hold a link (an image) gets a "… (link)"
 *   ("… (image)") column with its URL next to it.
 * - **Name:** the caption, else `aria-label`, else the heading above the table, else "Table 3".
 * - **Left out:** hidden tables, tables in navigation (menus, navboxes), `role="presentation"`, tables
 *   with one column (a list), or no data row (2 rows when there is no header), and layout tables (most cells hold blocks of content). A table
 *   inside a cell of another is read as its own table.
 */
import { visible } from '../reveal/disclosure';

export interface PageTable {
    /** Index among the tables found, for `showTable`. */
    index: number;
    name: string;
    kind: 'table' | 'grid';
    columns: string[];
    rows: string[][];
    /** Rows on the page, when more than `MAX_ROWS` were read. */
    totalRows?: number;
}

const MAX_ROWS = 10_000;
const NAV = 'nav, [role="navigation"], [role="menu"], [role="menubar"], [role="tablist"]';
const BLOCKS = 'table, form, ul, ol, h1, h2, h3, h4, h5, h6, section, article, nav, iframe';
const LAYOUT_CELL_CHARS = 400;

/** Citation markers ("[12]", "[a]", "[citation needed]") are the page's footnotes, not the value. */
const CITATION = /\[(\d{1,3}|[a-z]|note \d{1,3}|citation needed)\]/gi;
const clean = (s: string) => s.replace(CITATION, '').replace(/\s+/g, ' ').trim();
/** A cell's text: as shown (`innerText` keeps line breaks between parts) when laid out. */
const textOf = (el: Element, live: boolean) => clean((live ? (el as HTMLElement).innerText : undefined) ?? el.textContent ?? '');

let found: Element[] = [];

interface Cell { el: Element; header: boolean }

/** Rows of cells with spans expanded: `grid[r][c]` is the cell covering that position (or null). */
function expand(rows: Cell[][], spans: (c: Cell) => { cols: number; rows: number }): (Cell | null)[][] {
    const grid: (Cell | null)[][] = [];
    rows.forEach((cells, r) => {
        grid[r] = grid[r] ?? [];
        let c = 0;
        for (const cell of cells) {
            while (grid[r][c]) c++;
            const span = spans(cell);
            for (let dr = 0; dr < span.rows && r + dr < rows.length; dr++) {
                grid[r + dr] = grid[r + dr] ?? [];
                for (let dc = 0; dc < span.cols; dc++) grid[r + dr][c + dc] = cell;
            }
            c += span.cols;
        }
    });
    const width = Math.max(0, ...grid.map(r => r.length));
    return grid.map(r => Array.from({ length: width }, (_, i) => r[i] ?? null));
}

const span = (v: string | null, max: number) => Math.min(max, Math.max(1, parseInt(v ?? '1', 10) || 1));

function htmlRows(table: HTMLTableElement): { cells: Cell[][]; head: number } {
    const rows = Array.from(table.rows).filter(tr => tr.closest('table') === table);
    const cells = rows.map(tr => Array.from(tr.cells).map(el => ({ el, header: el.tagName === 'TH' })));
    const inHead = rows.filter(tr => tr.parentElement?.tagName === 'THEAD').length;
    return { cells, head: inHead };
}

function gridRows(grid: Element): { cells: Cell[][]; head: number } {
    const rows = Array.from(grid.querySelectorAll('[role="row"]')).filter(r => r.parentElement?.closest('[role="table"], [role="grid"], [role="treegrid"]') === grid);
    const cells = rows.map(row => Array.from(row.querySelectorAll('[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]'))
        .filter(c => c.closest('[role="row"]') === row)
        .map(el => ({ el, header: el.getAttribute('role') === 'columnheader' })));
    return { cells, head: 0 };
}

function headingBefore(el: Element): string {
    let steps = 0;
    for (let node: Element | null = el; node && node !== el.ownerDocument.body && steps < 200; node = node.parentElement) {
        for (let s = node.previousElementSibling; s && steps < 200; s = s.previousElementSibling, steps++) {
            if (/^H[1-6]$/.test(s.tagName)) return clean(s.textContent ?? '');
            const inner = s.querySelectorAll('h1, h2, h3, h4, h5, h6');
            if (inner.length) return clean(inner[inner.length - 1].textContent ?? '');
        }
    }
    return '';
}

function nameOf(el: Element, n: number): string {
    const caption = el.tagName === 'TABLE' ? (el as HTMLTableElement).caption : null;
    const label = (caption ? clean(caption.textContent ?? '') : '') || clean(el.getAttribute('aria-label') ?? '') || headingBefore(el);
    return (label || `Table ${n}`).slice(0, 80);
}

/** The cell's first link to somewhere else (an in-page "#" link, a footnote, isn't one). */
const linkOf = (cell: Element) => Array.from(cell.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .find(a => !a.getAttribute('href')!.trim().startsWith('#') && !a.closest('sup'))?.href ?? '';
const imageOf = (cell: Element) => { const img = cell.querySelector<HTMLImageElement>('img'); return img ? (img.currentSrc || img.src) : ''; };

/** One table read, or null when it isn't a data table. */
function readTable(el: Element, kind: PageTable['kind'], live: boolean): Omit<PageTable, 'index' | 'name'> | null {
    const { cells, head } = kind === 'table' ? htmlRows(el as HTMLTableElement) : gridRows(el);
    if (!cells.length) return null;
    const grid = expand(cells, c => ({ cols: span(c.el.getAttribute('colspan') ?? c.el.getAttribute('aria-colspan'), 50), rows: span(c.el.getAttribute('rowspan') ?? c.el.getAttribute('aria-rowspan'), 500) }));
    let headRows = head;
    if (!headRows) while (headRows < grid.length - 1 && grid[headRows].every(c => !c || c.header)) headRows++;
    const body = grid.slice(headRows).filter(r => r.some(c => c && textOf(c.el, live)));
    const width = grid[0]?.length ?? 0;
    // A header and one row is a table (a spec, a one-row result); with no header it takes two.
    if (body.length < (headRows ? 1 : 2) || width < 2) return null;

    // A layout table: most of its cells hold blocks of content, not values.
    const distinct = [...new Set(body.flat().filter((c): c is Cell => !!c))];
    const blocky = distinct.filter(c => c.el.querySelector(BLOCKS) || textOf(c.el, live).length > LAYOUT_CELL_CHARS).length;
    if (blocky > distinct.length / 2) return null;

    const headers = Array.from({ length: width }, (_, i) => {
        const parts = grid.slice(0, headRows).map(r => (r[i] ? textOf(r[i]!.el, live) : '')).filter(Boolean);
        return [...new Set(parts)].join(' › ');
    });
    const used = new Set<string>();
    const unique = (name: string) => { let n = name; for (let k = 2; used.has(n); k++) n = `${name} ${k}`; used.add(n); return n; };

    const columns: string[] = [];
    const readers: ((row: (Cell | null)[]) => string)[] = [];
    for (let i = 0; i < width; i++) {
        const cellsIn = body.map(r => r[i]).filter((c): c is Cell => !!c);
        const name = unique(headers[i] || `Column ${i + 1}`);
        columns.push(name);
        readers.push(r => (r[i] ? textOf(r[i]!.el, live) : ''));
        const half = Math.max(1, cellsIn.length / 2);
        if (cellsIn.filter(c => linkOf(c.el)).length >= half) { columns.push(unique(`${name} (link)`)); readers.push(r => (r[i] ? linkOf(r[i]!.el) : '')); }
        if (cellsIn.filter(c => imageOf(c.el)).length >= half) { columns.push(unique(`${name} (image)`)); readers.push(r => (r[i] ? imageOf(r[i]!.el) : '')); }
    }
    const rows = body.slice(0, MAX_ROWS).map(r => readers.map(read => read(r)));
    return { kind, columns, rows, ...(body.length > MAX_ROWS ? { totalRows: body.length } : {}) };
}

export function findTables(doc: Document = document, live = true): PageTable[] {
    const candidates = Array.from(doc.querySelectorAll('table, [role="table"], [role="grid"], [role="treegrid"]'))
        .filter(el => {
            const role = el.getAttribute('role');
            if (role === 'presentation' || role === 'none') return false;
            return !el.closest(NAV) && visible(el, live);
        });
    const tables: PageTable[] = [];
    found = [];
    for (const el of candidates) {
        const read = readTable(el, el.tagName === 'TABLE' ? 'table' : 'grid', live);
        if (!read) continue;
        found.push(el);
        tables.push({ index: tables.length, name: nameOf(el, tables.length + 1), ...read });
    }
    return tables;
}

/** Scrolls to a table found by the last `findTables` and outlines it for a moment. */
export function showTable(index: number): boolean {
    const el = found[index] as HTMLElement | undefined;
    if (!el?.isConnected) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const before = el.style.outline;
    el.style.outline = '3px solid #C8F03C';
    setTimeout(() => { el.style.outline = before; }, 2000);
    return true;
}
