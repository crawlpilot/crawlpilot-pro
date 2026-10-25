/**
 * Isolated-world side of the API Finder: asks the MAIN-world hook (public/net-hook.js) for its buffer
 * over window.postMessage. The hook keeps the data; this only relays it to the extension.
 */
import type { NetEntry } from '../../../shared/network/types';

let counter = 0;

export function requestNetEntries(timeoutMs = 2500): Promise<{ installed: boolean; entries: NetEntry[] }> {
    // The hook marks the page when it installs; without the mark nothing would answer, so don't wait.
    if (!document.documentElement.hasAttribute('data-crawlpilot-net')) return Promise.resolve({ installed: false, entries: [] });
    return new Promise(resolve => {
        const id = `cp-${Date.now()}-${++counter}`;
        const timer = setTimeout(() => {
            window.removeEventListener('message', onMessage);
            resolve({ installed: false, entries: [] });
        }, timeoutMs);
        function onMessage(ev: MessageEvent) {
            if (ev.source !== window || ev.data?.source !== 'crawlpilot-net-res' || ev.data.id !== id) return;
            clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            resolve({ installed: true, entries: Array.isArray(ev.data.entries) ? ev.data.entries : [] });
        }
        window.addEventListener('message', onMessage);
        window.postMessage({ source: 'crawlpilot-net-req', id }, location.origin === 'null' ? '*' : location.origin);
    });
}

export function clearNetEntries() {
    window.postMessage({ source: 'crawlpilot-net-clear' }, location.origin === 'null' ? '*' : location.origin);
}
