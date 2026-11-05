/**
 * Test on N pages (`docs/design/LLD.md` §7.2): each sample page opens in a background tab, the recipe is
 * tested there as on this page, and the tab closes. Pages go one at a time, the recipe's pace apart. It
 * runs from the side panel and writes no table: only the test run.
 */
import type { PageRecipeSpec, RunSettings } from '../recipe/types';
import { testOnTab, type PageResult } from './testPage';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Resolves when the tab has loaded, or after `timeout` (a slow page is still tried). */
function loaded(tabId: number, timeout: number): Promise<void> {
    return new Promise(resolve => {
        const done = () => { clearTimeout(cap); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); };
        const onUpdated = (id: number, info: { status?: string }) => { if (id === tabId && info.status === 'complete') done(); };
        const cap = setTimeout(done, timeout);
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.get(tabId).then(t => { if (t.status === 'complete') done(); }, done);
    });
}

/** The content script starts after the load: an early message finds no one listening. */
const notListening = (error?: string) => !!error && /Receiving end does not exist|Could not establish connection/i.test(error);

export interface PagesProgress {
    done: number;
    total: number;
    url: string;
}

/** `context`: test values of the recipe's variables; each page sets its session up as the recipe says. */
export async function testOnPages(urls: string[], spec: PageRecipeSpec, settings: RunSettings,
    onProgress?: (p: PagesProgress) => void, stopped?: () => boolean, context?: Record<string, string>): Promise<PageResult[]> {
    const results: PageResult[] = [];
    const pace = typeof settings.requestDelay === 'number' ? settings.requestDelay : 1000;
    const loadTimeout = typeof settings.loadTimeout === 'number' ? settings.loadTimeout : 15000;
    for (const [i, url] of urls.entries()) {
        if (stopped?.()) break;
        onProgress?.({ done: i, total: urls.length, url });
        let tabId: number | undefined;
        try {
            tabId = (await chrome.tabs.create({ url, active: false })).id;
            if (tabId === undefined) throw new Error('No tab');
            await loaded(tabId, loadTimeout);
            let result = await testOnTab(tabId, url, spec, settings, context);
            for (let tries = 0; notListening(result.error) && tries < 10; tries++) {
                await sleep(500);
                result = await testOnTab(tabId, url, spec, settings, context);
            }
            results.push(result);
        } catch (e) {
            results.push({ url, fields: [], clicks: [], error: e instanceof Error ? e.message : String(e) });
        } finally {
            if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => {});
        }
        if (i < urls.length - 1) await sleep(pace);
    }
    onProgress?.({ done: results.length, total: urls.length, url: '' });
    return results;
}
