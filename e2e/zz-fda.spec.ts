import { test, pickList } from './harness';
import { expect } from '@playwright/test';
import fs from 'node:fs';
const URL = 'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts';
test('fda probe', async ({ ext, panel }) => {
    test.setTimeout(180_000);
    const opened = ext.waitForEvent('page');
    await panel.page.evaluate(u => chrome.tabs.create({ url: u, active: true }), URL);
    const page = await opened;
    await page.waitForTimeout(12000);
    const info = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table')).map(t => ({
            id: t.id, cls: t.className, rows: t.querySelectorAll('tbody tr').length,
            firstRow: (t.querySelector('tbody tr') as HTMLElement | null)?.innerText.slice(0, 200),
            head: (t.querySelector('thead') as HTMLElement | null)?.innerText.slice(0, 200),
            parents: (() => { const p: string[] = []; let e = t.parentElement; for (let i = 0; i < 4 && e; i++, e = e.parentElement) p.push(`${e.tagName.toLowerCase()}#${e.id}.${e.className}`.slice(0, 60)); return p; })(),
        }));
        return { title: document.title, len: document.body.innerText.length, tables };
    });
    console.log(JSON.stringify(info, null, 1));
    fs.writeFileSync('/private/tmp/claude-501/-Users-rahulbisht-Documents-Github-work-crawlPilot/13257769-5355-4f1e-aa19-3459f8d4b8dd/scratchpad/fda/live.html', await page.content());
    if (!info.tables.length) return;
    const sel = await pickList(panel, page, 'table tbody tr td');
    console.log('PICK', JSON.stringify({ ...sel, data: undefined, items: sel?.data?.items?.length ?? sel?.items?.length, cols: (sel?.data?.columns ?? sel?.columns)?.map((c: any) => c.name), first: (sel?.data?.items ?? sel?.items)?.[0], keys: Object.keys(sel ?? {}) }).slice(0, 3000));
    const tabId = await panel.tabId(page.url());
    const nextCtl = await panel.toTab(tabId, 'FIND_NEXT');
    console.log('NEXT', JSON.stringify(nextCtl));
    if (nextCtl.control) {
        await panel.clear();
        await panel.toTab(tabId, 'EXECUTE_PAGINATION', {
            container: sel.container, items: sel.items, next: nextCtl.control.selectors, maxPages: 3, mode: nextCtl.control.mode,
            navigationDelay: 0, contentLoadDelay: 1500, pageLoadDelay: 1000, urlChangeTimeout: 8000,
            columns: sel.data?.columns,
        });
        const done = await panel.next('PAGINATION_COMPLETE', 120_000);
        const updates = await panel.received('PAGINATION_UPDATE');
        console.log('PAGINATION', JSON.stringify(done), 'updates', updates.length, 'rows per update', updates.map((u: any) => u.items?.length), 'first', JSON.stringify(updates[0]?.items?.[0])?.slice(0, 300));
        const logs = await panel.received('PAGINATION_LOG');
    }
    const pager = await page.evaluate(() => {
        const p = document.querySelector('.dataTables_paginate, .dt-paging, [class*="paginat"], [class*="paging"]');
        const next = Array.from(document.querySelectorAll('a, button, li')).filter(e => /^\s*Next\s*$/i.test(e.textContent || '')).map(e => `${e.tagName.toLowerCase()}#${e.id}.${e.className} ${e.getAttribute('aria-controls') ?? ''} ${(e as HTMLElement).offsetParent ? 'shown' : 'hidden'}`);
        return { pager: p ? (p as HTMLElement).outerHTML.slice(0, 1200) : null, next };
    });
    console.log('PAGER', JSON.stringify(pager));
    const nextSel = pager.next.length ? (pager.next[0].startsWith('a#datatable_next') || pager.next[0].includes('#datatable_next') ? '#datatable_next' : null) : null;
    const nextPick = await (await import('./harness')).pickElement(panel, page, pager.next.find((n: string) => n.includes('shown'))?.includes('button') ? 'button:has-text("Next")' : 'a:has-text("Next"), li:has-text("Next") a');
    console.log('NEXTPICK', JSON.stringify(nextPick.selectors));
    await panel.clear();
    await panel.toTab(tabId, 'EXECUTE_PAGINATION', {
        container: sel.container, items: sel.items, next: nextPick.selectors, maxPages: 3,
        navigationDelay: 0, contentLoadDelay: 1500, pageLoadDelay: 1000, urlChangeTimeout: 8000,
        columns: sel.data?.columns,
    });
    const pdone = await panel.next('PAGINATION_COMPLETE', 120_000);
    const updates = await panel.received('PAGINATION_UPDATE');
    console.log('PAGINATION', JSON.stringify(pdone), 'updates', updates.length, 'rows', updates.map((u: any) => u.items?.length), JSON.stringify(updates.map((u: any) => u.items?.[0]?.date + ' ' + u.items?.[0]?.brand_name_s)));
});
