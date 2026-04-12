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



        default:
            console.warn('Unknown message type:', message.type);
            return { error: 'Unknown message type' };
    }
});

// Export for use in other parts
export { db };
