/**
 * Datasets kept in sync with the user's Google Sheet (docs/plans/leads-and-sheets-plan.md §2). The
 * first send writes every row to the dataset's tab; after that, rows added to the dataset by any run
 * or tool are appended (`tables.appendRows` queues a sync). Rows sent so far are counted on the
 * dataset after each batch, so a sync cut short (the side panel closed, the worker stopped) resumes.
 */
import { tables } from '../db/tables';
import { storage } from '../storage';
import { appendToSheet, tabName } from './sheets';
import { exportData } from '../../sidepanel/components/ui/data-table/pipeline';

/** One sync at a time per dataset; a request while one runs is picked up by it. */
const running = new Map<number, Promise<void>>();
const again = new Set<number>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Syncs the dataset soon (rows usually arrive in a burst). */
export function queueSync(id: number, delayMs = 1500) {
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => { timers.delete(id); void syncTable(id); }, delayMs));
}

/** Appends the dataset's rows not yet sent. Errors are kept on the dataset (`view.sheet.error`). */
export function syncTable(id: number): Promise<void> {
    const current = running.get(id);
    if (current) { again.add(id); return current; }
    const run = (async () => {
        try {
            do {
                again.delete(id);
                await syncOnce(id);
            } while (again.has(id));
        } finally {
            running.delete(id);
        }
    })();
    running.set(id, run);
    return run;
}

async function syncOnce(id: number) {
    const table = await tables.get(id);
    const sheet = table?.view.sheet;
    if (!table || !sheet?.sync) return;
    const conn = (await storage.get('integrations'))?.sheets;
    if (!conn) {
        await tables.update(id, { view: { sheet: { ...sheet, error: 'Google Sheets is not connected (Settings → Integrations).' } } });
        return;
    }
    const total = await tables.rowCount(id);
    if (total <= sheet.synced && sheet.url) return;
    const fresh = await tables.rowsPage(id, sheet.synced, Math.max(0, total - sheet.synced));
    // As the data table exports it: the user's names, merged and typed columns, lists as JSON.
    const out = exportData(table.columns, fresh, {}, table.view.merges ?? [], table.view.typed ?? []);
    const names = out.columns.map(c => c.name);
    const rows = out.rows.map(r => Object.fromEntries(out.columns.map(c => [c.name, r[c.id]])));
    let synced = sheet.synced;
    try {
        const res = await appendToSheet(conn, sheet.tab, names, rows, async written => {
            await tables.update(id, { view: { sheet: { ...sheet, synced: sheet.synced + written, error: undefined } } });
            synced = sheet.synced + written;
        });
        await tables.update(id, { view: { sheet: { ...sheet, synced, url: res.url ?? sheet.url, error: undefined } } });
    } catch (e) {
        await tables.update(id, { view: { sheet: { ...sheet, synced, error: (e as Error).message } } });
        throw e;
    }
}

/** Sends a dataset to the sheet (every row) and keeps it in sync from now on. */
export async function sendTable(id: number): Promise<{ url?: string; rows: number }> {
    const table = await tables.get(id);
    if (!table) throw new Error('The dataset is gone.');
    if (!(await storage.get('integrations'))?.sheets) throw new Error('Connect Google Sheets first (Settings → Integrations).');
    const sheet = table.view.sheet ?? { tab: tabName(table.name), synced: 0, sync: true };
    await tables.update(id, { view: { sheet: { ...sheet, sync: true } } });
    await syncTable(id);
    const after = (await tables.get(id))?.view.sheet;
    return { url: after?.url, rows: after?.synced ?? 0 };
}

/** Stops appending new rows (what was sent stays in the sheet). */
export async function stopSync(id: number) {
    const table = await tables.get(id);
    if (table?.view.sheet) await tables.update(id, { view: { sheet: { ...table.view.sheet, sync: false } } });
}
