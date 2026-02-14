import type { Message } from '../types/messages';

/**
 * Send a message to the background service worker
 */
export async function sendToBackground<T extends Message>(
    message: T
): Promise<any> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(response);
            }
        });
    });
}

/**
 * Send a message to a specific tab
 */
export async function sendToTab<T extends Message>(
    tabId: number,
    message: T
): Promise<any> {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(response);
            }
        });
    });
}

/**
 * Listen for messages
 */
export function onMessage<T extends Message>(
    handler: (message: T, sender: chrome.runtime.MessageSender) => void | Promise<any>
): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const result = handler(message as T, sender);

        // Handle async responses
        if (result instanceof Promise) {
            result.then(sendResponse).catch((error) => {
                console.error('Message handler error:', error);
                sendResponse({ error: error.message });
            });
            return true; // Keep channel open for async response
        }

        return false;
    });
}

/**
 * Broadcast message to all extension contexts
 */
export async function broadcast<T extends Message>(message: T): Promise<void> {
    // Send to all tabs
    const tabs = await chrome.tabs.query({});
    const promises = tabs.map((tab) => {
        if (tab.id) {
            return sendToTab(tab.id, message).catch(() => {
                // Ignore errors for tabs that don't have content scripts
            });
        }
    });

    // Also send to runtime (other extension pages)
    promises.push(sendToBackground(message).catch(() => { }));

    await Promise.all(promises);
}
