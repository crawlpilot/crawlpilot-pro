/**
 * A dataset as an Excel workbook (docs/plans/product-improvements-plan.md §5, S6): one sheet, typed
 * cells, so Excel sorts and sums what it opens. Numbers and prices are numbers, dates are dates,
 * links are links, lists are one value per line. The header is bold and frozen, with filters.
 *
 * SpreadsheetML written by hand (inline strings, no shared-string table), zipped with fflate.
 */
import { strToU8, zipSync } from 'fflate';

export interface XlsxColumn { id: string; name: string; type?: string }

/** Excel's cell limit. */
const MAX_CELL = 32_767;
/** Hyperlinks per sheet Excel accepts; past it a link is text. */
const MAX_LINKS = 65_000;
/** Excel's day 0 is 1899-12-30; Unix day 0 is its day 25,569. */
const EXCEL_EPOCH_DAYS = 25_569;

// Styles (cellXfs order in styles.xml): 0 plain, 1 date, 2 date-time, 3 link, 4 header, 5 wrapped text.
const STYLE = { date: 1, dateTime: 2, link: 3, header: 4, wrap: 5 } as const;

const xml = (s: string) => s
    // Characters XML 1.0 can't hold (control characters other than tab, newline and return).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A column number as Excel's letters: 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
    let n = index + 1;
    let out = '';
    while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
    return out;
}

const NUMERIC_TYPES = new Set(['number', 'price', 'money', 'count', 'percent', 'rating']);
const DATE_TYPES = new Set(['date', 'datetime']);
const LINK_TYPES = new Set(['url', 'link', 'image', 'email']);

/** A number as the column holds it: "1,299.00" and "$59.99" in a number or price column. */
function asNumber(v: unknown, type?: string): number | null {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string' || !type || !NUMERIC_TYPES.has(type)) return null;
    const s = v.trim().replace(/^[^\d.-]+|[^\d.]+$/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** A date as Excel's serial number (days since 1899-12-30), and whether it has a time of day. */
function asDate(v: unknown, type?: string): { serial: number; time: boolean } | null {
    if (typeof v !== 'string' || !type || !DATE_TYPES.has(type)) return null;
    if (!/^\d{4}-\d{2}-\d{2}/.test(v.trim())) return null;
    const ms = Date.parse(v.trim());
    if (Number.isNaN(ms)) return null;
    const time = /T\d{2}:\d{2}/.test(v) && !/T00:00(:00(\.0+)?)?(Z|[+-]00:?00)?$/.test(v.trim());
    return { serial: ms / 86_400_000 + EXCEL_EPOCH_DAYS, time };
}

const isLink = (v: string) => /^(https?:\/\/|mailto:)\S+$/i.test(v);

/** Text of a value: lists one per line, objects as JSON, cut to Excel's cell limit. */
function asText(v: unknown): string {
    let s: string;
    if (Array.isArray(v)) s = v.map(x => (x && typeof x === 'object' ? JSON.stringify(x) : String(x ?? ''))).join('\n');
    else if (v && typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL - 1)}…` : s;
}

/** A sheet name Excel accepts: no `[]:*?/\`, at most 31 characters, not empty. */
export function sheetName(name: string): string {
    return name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Data';
}

function stylesXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

/** The workbook's bytes: one sheet named `name`, the header row then a row per data row. */
export function xlsxBytes(columns: XlsxColumn[], rows: Record<string, unknown>[], name = 'Data'): Uint8Array {
    const links: { ref: string; target: string }[] = [];
    const widths = columns.map(c => Math.min(Math.max(c.name.length + 2, 8), 60));
    const lines: string[] = [];

    const header = columns.map((c, i) => `<c r="${columnLetter(i)}1" t="inlineStr" s="${STYLE.header}"><is><t>${xml(c.name)}</t></is></c>`).join('');
    lines.push(`<row r="1">${header}</row>`);

    rows.forEach((row, r) => {
        const rowNum = r + 2;
        const cells: string[] = [];
        columns.forEach((col, i) => {
            const v = row[col.id];
            if (v === undefined || v === null || v === '') return;
            const ref = `${columnLetter(i)}${rowNum}`;
            if (typeof v === 'boolean') { cells.push(`<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`); return; }
            const num = asNumber(v, col.type);
            if (num !== null) { cells.push(`<c r="${ref}"><v>${num}</v></c>`); widths[i] = Math.max(widths[i], Math.min(String(num).length + 2, 20)); return; }
            const date = asDate(v, col.type);
            if (date) { cells.push(`<c r="${ref}" s="${date.time ? STYLE.dateTime : STYLE.date}"><v>${date.serial}</v></c>`); widths[i] = Math.max(widths[i], date.time ? 17 : 11); return; }
            const text = asText(v);
            let style = text.includes('\n') ? STYLE.wrap : 0;
            if (typeof v === 'string' && isLink(text) && (LINK_TYPES.has(col.type ?? '') || col.type === undefined || col.type === 'text') && links.length < MAX_LINKS && text.length <= 2_000) {
                links.push({ ref, target: text });
                style = STYLE.link;
            }
            const firstLine = text.split('\n')[0];
            widths[i] = Math.max(widths[i], Math.min(firstLine.length + 2, 60));
            cells.push(`<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xml(text)}</t></is></c>`);
        });
        lines.push(`<row r="${rowNum}">${cells.join('')}</row>`);
    });

    const last = `${columnLetter(Math.max(columns.length - 1, 0))}${rows.length + 1}`;
    const cols = columns.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${cols}<sheetData>${lines.join('')}</sheetData>${columns.length ? `<autoFilter ref="A1:${last}"/>` : ''}${links.length ? `<hyperlinks>${links.map((l, k) => `<hyperlink ref="${l.ref}" r:id="rId${k + 1}"/>`).join('')}</hyperlinks>` : ''}
</worksheet>`;
    const sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map((l, k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(l.target)}" TargetMode="External"/>`).join('')}</Relationships>`;

    const files: Record<string, Uint8Array> = {
        '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
        '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
        'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName(name))}" sheetId="1" r:id="rId1"/></sheets>${columns.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xml(sheetName(name)).replace(/'/g, "''")}'!$A$1:$${columnLetter(columns.length - 1)}$${rows.length + 1}</definedName></definedNames>` : ''}</workbook>`),
        'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
        'xl/styles.xml': strToU8(stylesXml()),
        'xl/worksheets/sheet1.xml': strToU8(sheet),
    };
    if (links.length) files['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(sheetRels);
    return zipSync(files, { level: 6 });
}
