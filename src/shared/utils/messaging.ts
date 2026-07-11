import type { Message } from '../types/messages';

function sendMessageOnce(message: Message): Promise<{ response?: any; error?: string }> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                resolve({ error: chrome.runtime.lastError.message });
            } else {
                resolve({ response });
            }
        });
    });
}

/**
 * Send a message to the background service worker.
 * Retries once after a short delay when the service worker is cold-starting
 * ("Could not establish connection. Receiving end does not exist.").
 */
export async function sendToBackground<T extends Message>(
    message: T
): Promise<any> {
    let result = await sendMessageOnce(message);
    if (result.error && result.error.includes('Receiving end does not exist')) {
        await new Promise(r => setTimeout(r, 200));
        result = await sendMessageOnce(message);
    }
    if (result.error) {
        throw new Error(result.error);
    }
    return result.response;
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
