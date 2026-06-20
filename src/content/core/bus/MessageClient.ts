export type MessageCallback = (message: any, sendResponse: (response?: any) => void) => void | boolean | Promise<void>;

export class MessageClient {
    private static instance: MessageClient;
    private listeners: Map<string, MessageCallback> = new Map();

    private constructor() {
        chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    }

    public static getInstance(): MessageClient {
        if (!MessageClient.instance) {
            MessageClient.instance = new MessageClient();
        }
        return MessageClient.instance;
    }

    public on(type: string, callback: MessageCallback) {
        this.listeners.set(type, callback);
    }

    public send(message: any): Promise<any> {
        return new Promise((resolve, reject) => {
            // Guard: extension context is invalidated when the service worker restarts.
            // The content script cannot recover from this — log and resolve empty so
            // callers don't hang on an unresolved promise.
            if (!chrome.runtime?.id) {
                console.warn('[MessageClient] Extension context invalidated — cannot send message');
                resolve(undefined);
                return;
            }

            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        // "Could not establish connection" is expected on first message after SW restart.
                        // Resolve rather than reject so the caller degrades gracefully.
                        console.warn('[MessageClient] lastError:', chrome.runtime.lastError.message);
                        resolve(undefined);
                        return;
                    }
                    resolve(response);
                });
            } catch (e) {
                console.error('[MessageClient] Failed to send message:', e);
                reject(e);
            }
        });
    }

    private handleMessage(message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
        if (message && message.type && this.listeners.has(message.type)) {
            const callback = this.listeners.get(message.type)!;
            const result = callback(message, sendResponse);

            if (result instanceof Promise) {
                result.catch(err => {
                    console.error(`[MessageClient] Async handler error for ${message.type}:`, err);
                    sendResponse({ success: false, error: err.message });
                });
                return true;
            }

            return result === true;
        }
        return false;
    }
}
