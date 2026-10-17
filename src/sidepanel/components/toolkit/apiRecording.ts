/**
 * Starts and stops the API Finder's page hook (public/net-hook.js, copied to the build root).
 * "Reload and record" registers it at document_start for the tab's origin so the calls a page makes
 * while loading are caught; "record from now" injects it into the open page.
 */
import { hasAllUrlsPermission, requestAllUrlsPermission, openSiteAccessSettings } from '../../../shared/utils/hostPermissions';

const SCRIPT_ID = 'crawlpilot-net-hook';
const HOOK_FILE = 'net-hook.js';

async function ensureAccess(): Promise<void> {
    if (await hasAllUrlsPermission()) return;
    const result = await requestAllUrlsPermission();
    if (result === 'unavailable') openSiteAccessSettings();
    if (result !== 'granted') throw new Error('CrawlPilot needs access to this site to record its API calls.');
}

async function activeTab(): Promise<chrome.tabs.Tab> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error('Open a web page (http or https) to record its API calls.');
    return tab;
}

export async function stopRecording(): Promise<void> {
    try {
        const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
        if (existing.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    } catch { /* nothing registered */ }
}

export async function isRecordingRegistered(): Promise<boolean> {
    try {
        return (await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length > 0;
    } catch {
        return false;
    }
}

/** @param reload true to reload the page and catch the calls made while it loads. */
export async function startRecording(reload: boolean): Promise<void> {
    await ensureAccess();
    const tab = await activeTab();
    if (reload) {
        const origin = new URL(tab.url!).origin;
        await stopRecording();
        await chrome.scripting.registerContentScripts([{
            id: SCRIPT_ID,
            js: [HOOK_FILE],
            matches: [`${origin}/*`],
            runAt: 'document_start',
            world: 'MAIN',
            allFrames: false,
            persistAcrossSessions: false,
        } as chrome.scripting.RegisteredContentScript]);
        await chrome.tabs.reload(tab.id!);
    } else {
        await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN', files: [HOOK_FILE] });
    }
}
