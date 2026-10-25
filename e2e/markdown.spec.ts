/** Page as Markdown (docs/plans/automation-and-page-tools-plan.md §3.7, T2): this page, and many pages as files. */
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { test, expect } from './harness';

test('this page as markdown: front matter, hidden sections read, Download .md', async ({ ext, origin, panel }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/hidden-sections.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=markdown&tabId=${tabId}`);

    const text = ui.getByTestId('markdown-text');
    await expect(text).toHaveValue(/^---\ntitle: "Oak Table · Hidden sections"\nurl: ".*hidden-sections\.html"/);
    await expect(text).toHaveValue(/Solid European oak/);
    await expect(text).not.toHaveValue(/SECRET-HIDDEN-TEXT/);
    await expect(ui.getByTestId('markdown-stats')).toContainText('hidden sections read: ');

    const [download] = await Promise.all([ui.waitForEvent('download'), ui.getByRole('button', { name: 'Download .md' }).click()]);
    expect(download.suggestedFilename()).toBe('oak-table-hidden-sections.md');
    const saved = fs.readFileSync((await download.path())!, 'utf8');
    expect(saved).toContain('# Oak Dining Table');
    expect(saved).toContain('Wipe clean with a damp cloth');

    // Off: hidden sections stay closed, and no front matter.
    await ui.getByText('Read hidden sections too').click();
    await ui.getByText('Front matter').click();
    await expect(text).not.toHaveValue(/Solid European oak/);
    await expect(text).not.toHaveValue(/^---/);
    await ui.close();
    await page.close();
});

test('many pages: a metadata run exports a zip of .md files and JSONL', async ({ ext, origin, panel }) => {
    const urls = ['article.html', 'hidden-sections.html', 'product.html'].map(f => `${origin}/site/${f}`);
    await panel.clear();
    const start = await panel.toExtension('METADATA_EXTRACTION_START', { urls, options: {}, maxConcurrent: 2, requestDelay: 0, customName: 'e2e markdown' });
    expect(start?.success).toBe(true);
    const done = await panel.next('METADATA_EXTRACTION_COMPLETE', 60_000);
    expect(done.success).toBe(true);

    const ui = await ext.newPage();
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=data-table&tableId=${done.tableId}`);
    const exportMenu = ui.getByRole('button', { name: 'Export' });
    await expect(exportMenu).toBeVisible();

    await exportMenu.click();
    const [zip] = await Promise.all([ui.waitForEvent('download'), ui.getByRole('menuitem', { name: 'Markdown files (.zip)' }).click()]);
    const files = unzipSync(fs.readFileSync((await zip.path())!));
    expect(Object.keys(files)).toHaveLength(3);
    const all = Object.values(files).map(f => strFromU8(f));
    expect(all.every(f => f.startsWith('---\ntitle:'))).toBe(true);
    expect(all.some(f => f.includes('Solid European oak'))).toBe(true);

    await exportMenu.click();
    const [jsonl] = await Promise.all([ui.waitForEvent('download'), ui.getByRole('menuitem', { name: 'JSONL for LLMs' }).click()]);
    const lines = fs.readFileSync((await jsonl.path())!, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines.map(l => l.url).sort()).toEqual([...urls].sort());
    expect(lines.every(l => l.markdown.length > 20 && l.fetched_at)).toBe(true);
    await ui.close();
});
