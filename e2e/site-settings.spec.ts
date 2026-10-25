/**
 * Site settings: speed, page wait and walls set once per site, used by every run of it; a rate limit
 * makes a site Careful by itself.
 */
import { test, expect, saveAsRecipe } from './harness';

const elements = [{ id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1'] }];

test('a site\'s settings set its runs\' pace; a rate limit makes it Careful', async ({ panel, origin }) => {
    test.setTimeout(120_000);
    // The test server's site: 1 tab at a time, no delay.
    await panel.page.evaluate(() => chrome.storage.local.set({ siteSettings: { '127.0.0.1': { pace: 'normal', delayMs: 0, tabs: 1 } } }));
    await panel.clear();
    const start = await panel.toExtension('BULK_EXTRACTION_START', { urls: [1, 2, 3].map(n => `${origin}/site/product.html?id=${n}`), elements, config: { requestDelay: 0 }, maxConcurrent: 3 });
    expect(start?.success).toBe(true);
    await panel.next('BULK_EXTRACTION_COMPLETE', 60_000);
    const job = (await panel.store('jobs')).find(j => j.id === start.jobId);
    expect(job.input.concurrency).toBe(1);

    // A page answers 429: the site goes Careful, marked as learned.
    await panel.page.evaluate(() => chrome.storage.local.remove('siteSettings'));
    await panel.clear();
    await panel.toExtension('BULK_EXTRACTION_START', { urls: [`${origin}/site/product.html?id=9&status=429`], elements, config: { requestDelay: 0 }, maxConcurrent: 1 });
    await expect.poll(async () => (await panel.page.evaluate(() => chrome.storage.local.get('siteSettings')) as any).siteSettings?.['127.0.0.1'], { timeout: 30_000 })
        .toMatchObject({ pace: 'careful', learned: { reason: expect.any(String) } });
    await panel.toExtension('BULK_EXTRACTION_STOP');
    await panel.page.evaluate(() => chrome.storage.local.remove('siteSettings'));
});

test('the list run\'s step 3 shows the site\'s settings; a change is saved for the site and shown on its recipe', async ({ panel, ext, origin }) => {
    test.setTimeout(150_000);
    await panel.page.evaluate(() => chrome.storage.local.remove('siteSettings'));
    const page = await ext.newPage();
    await page.goto(`${origin}/site/list-1.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=list-extractor&tabId=${tabId}`);
    await ui.getByRole('button', { name: 'Point at one item' }).click();
    const box = (await page.locator('li.card').first().boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + 20, box.y + 10);
    await expect(ui.getByText('4 items found')).toBeVisible({ timeout: 15_000 });
    await ui.getByRole('button', { name: 'Change', exact: true }).first().click();
    await ui.getByRole('button', { name: 'Continue' }).click();

    const card = ui.getByTestId('site-settings');
    await expect(card).toContainText('Site settings · 127.0.0.1');
    await expect(card).toContainText('1 s between pages · 3 tabs at a time');
    await card.getByRole('radio', { name: 'Careful' }).click();
    await expect(card).toContainText('4 s between pages · 1 tab at a time');
    await card.getByRole('radio', { name: 'Skip the page' }).click();
    await expect.poll(async () => (await panel.page.evaluate(() => chrome.storage.local.get('siteSettings')) as any).siteSettings?.['127.0.0.1'])
        .toMatchObject({ pace: 'careful', onWall: 'skip' });

    // Run it, then the recipe card opens the same settings.
    await ui.getByRole('button', { name: /Get the data|Start/ }).last().click();
    await expect(ui.getByText(/^Done · /)).toBeVisible({ timeout: 90_000 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=history&tabId=${tabId}`);
    await saveAsRecipe(ui, '127.0.0.1');
    await ui.getByTestId('recipe-card').filter({ hasText: '127.0.0.1' }).first().getByRole('button', { name: 'Site settings' }).click();
    await expect(ui.getByRole('dialog').getByTestId('site-settings')).toContainText('4 s between pages · 1 tab at a time');
    await panel.page.evaluate(() => chrome.storage.local.remove('siteSettings'));
});
