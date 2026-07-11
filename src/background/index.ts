import { db } from '../shared/db/db-manager';
import { onMessage } from '../shared/utils/messaging';
import type { Message, DataSavedMessage, ExtractionCompleteMessage, BulkExtractionStartMessage } from '../shared/types/messages';
import { BulkExtractionOrchestrator } from './extraction/BulkExtractionOrchestrator';
import { MetadataExtractionOrchestrator } from './extraction/MetadataExtractionOrchestrator';

// Bulk extraction orchestrator (singleton)
const bulkOrchestrator = new BulkExtractionOrchestrator();
const metadataOrchestrator = new MetadataExtractionOrchestrator();

// Service-worker health. Chrome clamps alarm periods to ≥30 s, which is too slow
// to prevent the ~30 s MV3 idle kill — real keep-alive during a run is a 20 s
// extension-API ping inside each orchestrator. This alarm exists to periodically
// wake the SW so interrupted runs get recovered even if their run-specific
// backstop alarm was somehow cleared.
chrome.alarms.create('sw_keepalive', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sw_keepalive') {
        bulkOrchestrator.recoverIfNeeded().catch(e => console.error('Recovery check failed:', e));
        return;
    }
    if (alarm.name === 'bulk_extraction_keepalive') {
        bulkOrchestrator.handleKeepAliveAlarm();
    }
    if (alarm.name === 'metadata_extraction_keepalive') {
        metadataOrchestrator.handleKeepAliveAlarm();
    }
});

// Initialize database on install
chrome.runtime.onInstalled.addListener(async (_) => {
    await db.init();
});

chrome.runtime.onStartup.addListener(() => {
    bulkOrchestrator.recoverIfNeeded().catch(e => console.error('Recovery on startup failed:', e));
});

// Initialize database on startup, then recover any run the previous service
// worker instance was killed in the middle of.
(async () => {
    await db.init();
    await bulkOrchestrator.recoverIfNeeded().catch(e => console.error('Recovery on SW spawn failed:', e));
})();

// Set up side panel behavior
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Side panel setup error:', error));


// Message handling
onMessage(async (message: Message, _sender) => {
    switch (message.type) {
        case 'EXTRACTION_COMPLETE': {
            const msg = message as ExtractionCompleteMessage;
            try {
                const tableDataId = await db.saveExtraction(msg.payload.data);

                // Notify sidepanel
                const dataSaved: DataSavedMessage = {
                    type: 'DATA_SAVED',
                    payload: { tableDataId },
                    timestamp: Date.now(),
                };

                // Broadcast to all extension contexts
                chrome.runtime.sendMessage(dataSaved).catch(() => { /* sidepanel may not be open */ });

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

        case 'DOWNLOAD_IMAGE_PROXY': {
            // Fetch image via background to bypass CORS restrictions
            const { url } = (message as any).payload as { url: string };
            try {
                const response = await fetch(url, {
                    mode: 'cors',
                    credentials: 'omit',
                    signal: AbortSignal.timeout(15_000),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const buffer = await response.arrayBuffer();
                const contentType = response.headers.get('content-type') || 'image/jpeg';
                return { success: true, data: Array.from(new Uint8Array(buffer)), contentType };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : 'Fetch failed' };
            }
        }

        case 'DOWNLOAD_VIA_CHROME': {
            // Use chrome.downloads API to save a file directly
            const { url: dlUrl, filename } = (message as any).payload as { url: string; filename?: string };
            try {
                const downloadId = await chrome.downloads.download({
                    url: dlUrl,
                    filename: filename || undefined,
                    saveAs: false
                });
                return { success: true, downloadId };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : 'Download failed' };
            }
        }

        case 'BULK_EXTRACTION_START': {
            const startMsg = message as BulkExtractionStartMessage;
            try {
                if (bulkOrchestrator.running) {
                    return { success: false, error: 'An extraction is already in progress' };
                }
                const { jobId, originalCount, uniqueCount } = await bulkOrchestrator.start({
                    urls: startMsg.payload.urls,
                    elements: startMsg.payload.elements,
                    config: startMsg.payload.config,
                    jobId: startMsg.payload.jobId,
                    recipeId: startMsg.payload.recipeId,
                    customName: startMsg.payload.customName,
                    maxConcurrent: startMsg.payload.maxConcurrent
                });
                return { success: true, jobId, originalCount, uniqueCount };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
            }
        }

        case 'BULK_EXTRACTION_STOP': {
            await bulkOrchestrator.stop();
            return { success: true };
        }

        case 'METADATA_EXTRACTION_START': {
            try {
                if (metadataOrchestrator.running) {
                    return { success: false, error: 'A metadata extraction is already in progress' };
                }
                const { jobId, uniqueCount } = await metadataOrchestrator.start({
                    urls: (message as any).payload.urls,
                    options: (message as any).payload.options ?? {},
                    maxConcurrent: (message as any).payload.maxConcurrent,
                    requestDelay: (message as any).payload.requestDelay,
                    loadTimeout: (message as any).payload.loadTimeout,
                    customName: (message as any).payload.customName,
                });
                return { success: true, jobId, uniqueCount };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
            }
        }

        case 'METADATA_EXTRACTION_STOP': {
            await metadataOrchestrator.stop();
            return { success: true };
        }

        case 'METADATA_EXTRACTION_PROGRESS':
        case 'METADATA_EXTRACTION_COMPLETE':
            return undefined;

        case 'BULK_EXTRACTION_PROGRESS':
        case 'BULK_EXTRACTION_COMPLETE':
            // These are outbound messages from orchestrator to sidepanel
            // Just pass through (already sent via chrome.runtime.sendMessage)
            return undefined;

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
        case 'SCAN_IMAGES_PROGRESS':
        case 'SCAN_IMAGES_BATCH':
            // These are handled by other parts of the extension (content script / sidepanel)
            // We just ignore them here to prevent warning logs
            return undefined;



        default:
            return { error: 'Unknown message type' };
    }
});

// Export for use in other parts
export { db };
