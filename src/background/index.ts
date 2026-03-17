import { db } from '../shared/db/db-manager';
import { onMessage } from '../shared/utils/messaging';
import type { Message, DataSavedMessage, ExtractionCompleteMessage } from '../shared/types/messages';

console.log('🔧 Background service worker loaded');

// Initialize database on install
chrome.runtime.onInstalled.addListener(async () => {
    console.log('📦 Extension installed/updated');
    await db.init();
});

// Initialize database on startup
(async () => {
    await db.init();
})();

// Set up side panel behavior
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Side panel setup error:', error));

// Helper to save auth data
const saveAuthData = (token: string, profile?: any) => {
    const storageData: any = { session_token: token };
    if (profile) {
        storageData.user_plan = profile.plan;
        storageData.last_login = profile.lastLogin;
        storageData.user_email = profile.email;
    }

    return new Promise((resolve) => {
        chrome.storage.local.set(storageData, () => {
            console.log('✅ Auth token and profile saved securely in storage.');
            // Notify other extension parts (like the sidepanel) to refresh
            chrome.runtime.sendMessage({
                type: 'AUTH_SUCCESS',
                token,
                profile
            }, () => {
                // Ignore empty response errors from inactive parts
                if (chrome.runtime.lastError) { /* ignore */ }
            });
            resolve({ success: true, message: 'Token and profile saved' });
        });
    });
};

// Helper to remove auth data
const clearAuthData = () => {
    return new Promise((resolve) => {
        chrome.storage.local.remove(['session_token', 'user_plan', 'last_login', 'user_email'], () => {
            console.log('🚪 User logged out. Local data removed.');
            resolve({ success: true });
        });
    });
};

// External message handling (Legacy / Optional Direct Connect)
chrome.runtime.onMessageExternal.addListener(
    (request, sender, sendResponse) => {
        console.log('🌐 Received external message from:', sender.url, request);

        // Verify sender is authorized
        const senderUrl = sender.url || '';
        const isAuthorized =
            senderUrl.startsWith('https://crawlpilot.tech') ||
            senderUrl.startsWith('https://www.crawlpilot.tech') ||
            senderUrl.startsWith('https://crawlpilot.github.io') ||
            senderUrl.startsWith('http://localhost');

        if (!isAuthorized) {
            console.warn('Blocked unauthorized external message from:', senderUrl);
            return;
        }

        if (request.type === 'AUTH_SUCCESS' && request.token) {
            saveAuthData(request.token, request.profile).then(sendResponse);
            return true;
        }

        if (request.type === 'AUTH_LOGOUT') {
            clearAuthData().then(sendResponse);
            return true;
        }
    }
);

// Message handling
onMessage(async (message: Message, _sender) => {
    console.log('📨 Background received:', message.type, message);

    switch (message.type) {
        case 'EXTRACTION_COMPLETE': {
            const msg = message as ExtractionCompleteMessage;
            try {
                // Save extraction data to IndexedDB
                const tableDataId = await db.saveExtraction(msg.payload.data);
                console.log('✅ Data saved with ID:', tableDataId);

                // Notify sidepanel
                const dataSaved: DataSavedMessage = {
                    type: 'DATA_SAVED',
                    payload: { tableDataId },
                    timestamp: Date.now(),
                };

                // Broadcast to all extension contexts
                chrome.runtime.sendMessage(dataSaved);

                return { success: true, tableDataId };
            } catch (error) {
                console.error('❌ Failed to save data:', error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        }

        case 'PING':
            return { pong: true };

        case 'AUTO_SCROLL_UPDATE':
        case 'AUTO_SCROLL_STATUS':
        case 'AUTO_SCROLL_COMPLETE':
        case 'EXECUTE_AUTO_SCROLL':
        case 'STOP_AUTO_SCROLL':
        case 'ELEMENT_SELECTED':
        case 'START_PICKER':
        case 'STOP_PICKER':
        case 'PAGINATION_UPDATE':
        case 'PAGINATION_STATUS':
        case 'PAGINATION_COMPLETE':
            // These are handled by other parts of the extension (content script / sidepanel)
            // We just ignore them here to prevent warning logs
            return undefined;

        case 'AUTH_SUCCESS':
            return await saveAuthData((message as any).token, (message as any).profile);

        case 'AUTH_LOGOUT':
            return await clearAuthData();



        default:
            console.warn('Unknown message type:', message.type);
            return { error: 'Unknown message type' };
    }
});

// Export for use in other parts
export { db };
