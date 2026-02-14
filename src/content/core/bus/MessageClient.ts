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
            try {
                if (!chrome.runtime?.id) {
                    console.warn('Extension context invalidated');
                    return;
                }
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('Runtime error:', chrome.runtime.lastError);
                        // reject(chrome.runtime.lastError); // Don't always reject, just warn
                    }
                    resolve(response);
                });
            } catch (e) {
                console.error('Failed to send message:', e);
                reject(e);
            }
        });
    }

    private handleMessage(message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
        if (message && message.type && this.listeners.has(message.type)) {
            const callback = this.listeners.get(message.type)!;
            return callback(message, sendResponse);
        }
        return false;
    }
}
