import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { closeDatabase } from '../db/idb';
import { sendTable, stopSync, syncTable } from './sheetsSync';
import { looksLikeWebApp, sheetsScript, tabName } from './sheets';

/** The user's sheet, as its Apps Script would write it: tabs of header + rows. */
let sheet: Record<string, { header: string[]; rows: unknown[][] }> = {};
let fail = false;
let local: Record<string, unknown> = {};

beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    sheet = {};
    fail = false;
    local = { integrations: { sheets: { url: 'https://script.google.com/macros/s/x/exec', secret: 'k' } } };
    (globalThis as any).chrome = { storage: { local: {
        get: async (keys: string[]) => Object.fromEntries(keys.filter(k => k in local).map(k => [k, local[k]])),
        set: async (o: Record<string, unknown>) => { Object.assign(local, o); },
    } } };
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
        const body = JSON.parse(init.body);
        if (fail) return new Response('<html>Sign in - Google Accounts</html>');
        if (body.secret !== 'k') return new Response(JSON.stringify({ ok: false, error: 'Wrong key' }));
        const tab = (sheet[body.sheet] ??= { header: [], rows: [] });
        for (const c of body.columns) if (!tab.header.includes(c)) tab.header.push(c);
        for (const r of body.rows) tab.rows.push(tab.header.map(h => r[h] ?? ''));
        return new Response(JSON.stringify({ ok: true, added: body.rows.length, url: `https://docs.google.com/s#gid=${body.sheet}` }));
    }) as any;
});
afterEach(async () => { await closeDatabase(); });

const result = (items: Record<string, any>[], columns = [{ id: 'title', name: 'Title', type: 'text' as const }, { id: 'tags', name: 'Tags', type: 'json' as const }]) =>
    ({ type: 'list', source_url: 'https://shop.test/s', columns, items });

describe('Google Sheets sync', () => {
    it('sends every row, then only new rows, until syncing stops', async () => {
        const id = await db.tables.save(result([{ title: 'A', tags: '["x","y"]' }, { title: 'B', tags: '[]' }]), { name: 'Shop: laptops' });
        const sent = await sendTable(id);
        expect(sent.rows).toBe(2);
        expect(sheet['Shop laptops']).toEqual({ header: ['Title', 'Tags'], rows: [['A', ['x', 'y']], ['B', []]] });

        await db.tables.appendRows(id, [{ title: 'C', tags: '[]' }]);
        await syncTable(id);
        expect(sheet['Shop laptops'].rows.map(r => r[0])).toEqual(['A', 'B', 'C']);
        // Nothing new: nothing sent twice.
        await syncTable(id);
        expect(sheet['Shop laptops'].rows).toHaveLength(3);

        await stopSync(id);
        await db.tables.appendRows(id, [{ title: 'D', tags: '[]' }]);
        await syncTable(id);
        expect(sheet['Shop laptops'].rows).toHaveLength(3);
        expect((await db.tables.get(id))?.view.sheet).toMatchObject({ synced: 3, sync: false });
    });

    it('rows added to a synced dataset reach the sheet by themselves', async () => {
        const id = await db.tables.save(result([{ title: 'A', tags: '[]' }]), { name: 'Auto' });
        await sendTable(id);
        await db.tables.appendRows(id, [{ title: 'B', tags: '[]' }, { title: 'C', tags: '[]' }]);
        await new Promise(r => setTimeout(r, 1800));
        await syncTable(id);
        expect(sheet.Auto.rows.map(r => r[0])).toEqual(['A', 'B', 'C']);
    });

    it('a failure is kept on the dataset and the rows are sent next time', async () => {
        const id = await db.tables.save(result([{ title: 'A', tags: '[]' }]), { name: 'Shop' });
        fail = true;
        await expect(sendTable(id)).rejects.toThrow(/Who has access: Anyone/);
        expect((await db.tables.get(id))?.view.sheet).toMatchObject({ synced: 0, sync: true, error: expect.stringContaining('sign-in') });
        fail = false;
        await syncTable(id);
        expect(sheet.Shop.rows).toEqual([['A', []]]);
        expect((await db.tables.get(id))?.view.sheet?.error).toBeUndefined();
    });

    it('the script has the secret, addresses are checked, tab names are what Sheets allows', () => {
        expect(sheetsScript('abc123')).toContain("const SECRET = 'abc123';");
        expect(looksLikeWebApp('https://script.google.com/macros/s/AKfy/exec')).toBe(true);
        expect(looksLikeWebApp('https://docs.google.com/spreadsheets/d/1')).toBe(false);
        expect(tabName('Prices [EU]: 2026/10')).toBe('Prices EU 2026 10');
    });
});
