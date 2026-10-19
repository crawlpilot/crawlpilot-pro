/**
 * Google Sheets without a CrawlPilot Google account (docs/plans/leads-and-sheets-plan.md §2): each user
 * connects their own spreadsheet through a small Apps Script they paste into it and deploy as a web
 * app. CrawlPilot posts rows to it; the script writes each dataset to a tab of its own, adding new
 * columns to the right. A secret in the script means only this user's CrawlPilot can write.
 */

export interface SheetsConnection {
    /** The web app's address (`https://script.google.com/macros/s/…/exec`). */
    url: string;
    secret: string;
    /** The spreadsheet, as the script reported it when connecting. */
    name?: string;
    spreadsheetUrl?: string;
}

/** Rows per request: a request well under Apps Script's limits, and quick to write. */
export const SHEETS_BATCH = 500;

export function newSecret(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

/** The Apps Script the user pastes into their spreadsheet (Extensions → Apps Script). */
export function sheetsScript(secret: string): string {
    return `// CrawlPilot → this spreadsheet. Deploy: Deploy → New deployment → Web app,
// Execute as: Me, Who has access: Anyone. Then paste the web app URL into CrawlPilot.
const SECRET = '${secret}';

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== SECRET) return reply({ ok: false, error: 'Wrong key: copy the script from CrawlPilot again.' });
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (body.test) return reply({ ok: true, name: book.getName(), url: book.getUrl() });
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const name = String(body.sheet || 'CrawlPilot').replace(/[\\[\\]*?:\\/\\\\]/g, ' ').slice(0, 99);
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    let header = sheet.getLastColumn() > 0 ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
    const missing = (body.columns || []).filter(function (c) { return header.indexOf(c) < 0; });
    if (missing.length) {
      sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
      header = header.concat(missing);
      sheet.setFrozenRows(1);
    }
    const rows = (body.rows || []).map(function (r) {
      return header.map(function (h) { const v = r[h]; return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : v; });
    });
    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
    return reply({ ok: true, added: rows.length, url: book.getUrl() + '#gid=' + sheet.getSheetId() });
  } finally {
    lock.releaseLock();
  }
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
}

/** Whether a web app address looks right (Apps Script's, or any https `…/exec` the user deployed). */
export function looksLikeWebApp(url: string): boolean {
    try {
        const u = new URL(url.trim());
        return (u.protocol === 'https:' || u.hostname === '127.0.0.1') && /\/exec\/?$/.test(u.pathname);
    } catch {
        return false;
    }
}

interface ScriptReply { ok: boolean; error?: string; name?: string; url?: string; added?: number }

async function post(conn: Pick<SheetsConnection, 'url' | 'secret'>, body: Record<string, unknown>): Promise<ScriptReply> {
    let res: Response;
    try {
        // text/plain: a simple request, no preflight; Apps Script answers through a redirect.
        res = await fetch(conn.url.trim(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: conn.secret, ...body }), redirect: 'follow' });
    } catch (e) {
        throw new Error(`Couldn't reach the sheet's script (${(e as Error).message}). Check the web app address.`);
    }
    const text = await res.text();
    let data: ScriptReply;
    try { data = JSON.parse(text); } catch {
        // A Google sign-in page: the deployment isn't open to "Anyone".
        throw new Error(/accounts\.google|<html/i.test(text)
            ? 'The script asked for a Google sign-in. Deploy it with "Who has access: Anyone".'
            : `The script answered something unexpected (HTTP ${res.status}).`);
    }
    if (!data.ok) throw new Error(data.error || 'The script refused the rows.');
    return data;
}

/** Checks the connection; the spreadsheet's name and address. */
export async function testSheets(conn: Pick<SheetsConnection, 'url' | 'secret'>): Promise<{ name: string; spreadsheetUrl: string }> {
    const r = await post(conn, { test: true });
    return { name: r.name ?? 'Spreadsheet', spreadsheetUrl: r.url ?? '' };
}

/**
 * Appends rows (keyed by column name) to the dataset's tab, in batches. Returns the rows written and
 * the tab's address; `onBatch` reports progress (rows written so far).
 */
export async function appendToSheet(conn: SheetsConnection, tab: string, columns: string[], rows: Record<string, unknown>[], onBatch?: (written: number) => Promise<void> | void): Promise<{ written: number; url?: string }> {
    let written = 0;
    let url: string | undefined;
    if (rows.length === 0) {
        const r = await post(conn, { sheet: tab, columns, rows: [] });
        return { written: 0, url: r.url };
    }
    for (let i = 0; i < rows.length; i += SHEETS_BATCH) {
        const batch = rows.slice(i, i + SHEETS_BATCH);
        const r = await post(conn, { sheet: tab, columns, rows: batch });
        written += batch.length;
        url = r.url ?? url;
        await onBatch?.(written);
    }
    return { written, url };
}

/** The tab a dataset goes to: its name, as a sheet name may be (≤ 99 characters, no []*?:/\). */
export function tabName(datasetName: string): string {
    return (datasetName || 'CrawlPilot').replace(/[[\]*?:/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 99) || 'CrawlPilot';
}
