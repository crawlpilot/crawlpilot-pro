/** Sends a message to the content script of the active tab, with a readable error when it is missing. */
export async function sendToActiveTab<T = any>(message: { type: string; payload?: any }): Promise<T> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab.');
    if (!tab.url || !/^https?:/.test(tab.url)) throw new Error('Open a web page (http or https) to use this tool.');
    try {
        const res = await chrome.tabs.sendMessage(tab.id, message);
        if (res && res.success === false) throw new Error(res.error || 'The page could not complete the request.');
        return res as T;
    } catch (e: any) {
        if (/Receiving end does not exist|Could not establish connection/i.test(e?.message || '')) {
            throw new Error('CrawlPilot is not connected to this page yet. Reload the page and try again.');
        }
        throw e;
    }
}

export async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked: ignore */ }
}
