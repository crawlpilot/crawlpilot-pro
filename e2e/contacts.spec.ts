/** Contacts from websites (docs/plans/leads-and-sheets-plan.md §1) on two small fake company sites. */
import { test, expect } from './harness';

test('a run over company websites: emails from contact pages (hidden, written out, built by script), phones, profiles', async ({ panel, origin }) => {
    const urls = [`${origin}/site/acme-home.html`, `${origin}/site/beta-home.html`];
    await panel.clear();
    const start = await panel.toExtension('CONTACTS_START', { urls, follow: 3, maxConcurrent: 2, requestDelay: 0, customName: 'e2e contacts' });
    expect(start?.success).toBe(true);
    const done = await panel.next('CONTACTS_COMPLETE', 90_000);
    expect(done.success).toBe(true);
    const rows = (await panel.store('rows')).filter(r => r.tableId === done.tableId).map(r => r.data);
    const acme = rows.find(r => r.source_url.includes('acme'))!;
    const beta = rows.find(r => r.source_url.includes('beta'))!;
    expect(acme.company).toBe('Acme Tools Ltd');
    expect(acme.emails.split('; ').sort()).toEqual(['info@acme.test', 'jane.doe@acme.test', 'press@acme.test', 'sales@acme.test']);
    // A role address first.
    expect(acme.email).toBe('info@acme.test');
    expect(acme.phone).toBe('+442079460000');
    expect(acme).toMatchObject({ linkedin: 'https://linkedin.com/company/acme-tools', x: 'https://x.com/acmetools', instagram: 'https://instagram.com/acme.tools', facebook: '' });
    expect(acme.pages_read).toBe(3);
    // Beta's contact page is built by script: opened in the tab and read there.
    expect(beta.email).toBe('hello@beta.test');
    expect(beta.github).toBe('https://github.com/beta-studio');
    expect(beta.email_page).toContain('beta-contact');
});

test('this page: contacts at once, with its contact pages', async ({ ext, origin, panel }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/acme-home.html`);
    await panel.toTab(await panel.tabId(page.url()), 'PING');
    const ui = await ext.newPage();
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=email-extractor`);
    // The page under test is the active one when the button is pressed.
    await page.bringToFront();
    await ui.getByRole('button', { name: 'Find contacts on this page' }).click();
    const found = ui.getByTestId('contacts-found');
    await expect(found).toContainText('Acme Tools Ltd');
    await expect(found).toContainText('sales@acme.test');
    await expect(found).toContainText('press@acme.test');
    await expect(found).toContainText('3 pages read');
    await ui.close();
    await page.close();
});
