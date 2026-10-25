/** Languages other than English load when used (`src/i18n/index.ts`): the side panel still shows them. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './harness';

const LOCALES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/i18n/locales');

/** Every string of a locale file, nested values included. */
function strings(file: string): string[] {
    const out: string[] = [];
    const walk = (v: unknown) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(JSON.parse(fs.readFileSync(path.join(LOCALES, file), 'utf8')));
    return out;
}

test('the side panel shows the chosen language, loaded on demand', async ({ ext, extensionId, panel }) => {
    // French strings that aren't also the English ones.
    const en = new Set(strings('en/home.json'));
    const fr = strings('fr/home.json').filter(s => s.length > 6 && !en.has(s) && !s.includes('{{'));
    const shown = async () => { const text = (await page.locator('#root').textContent()) ?? ''; return fr.filter(s => text.includes(s)).length; };

    await panel.page.evaluate(() => chrome.storage.local.set({ language: 'fr' }));
    const page = await ext.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect.poll(shown).toBeGreaterThan(0);
    // English again: the bundled language.
    await panel.page.evaluate(() => chrome.storage.local.remove('language'));
    await page.reload();
    await page.waitForFunction(() => (document.getElementById('root')?.innerText.length ?? 0) > 20);
    expect(await shown()).toBe(0);
    await page.close();
});
