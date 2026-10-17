import type { Message } from '../types/messages';

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
