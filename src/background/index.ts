import { db } from '../shared/db/db-manager';
import { fail, ok, on } from '../shared/messages';
import { BulkExtractionOrchestrator } from './extraction/BulkExtractionOrchestrator';
import { MetadataExtractionOrchestrator } from './extraction/MetadataExtractionOrchestrator';
import { injectContentScriptIntoOpenTabs } from '../shared/utils/hostPermissions';

// Bulk extraction orchestrator (singleton)
const bulkOrchestrator = new BulkExtractionOrchestrator();
const metadataOrchestrator = new MetadataExtractionOrchestrator();

// Keep-alive alarm listener for background extraction and service-worker health.
// MV3 service workers idle out after ~30 s. A periodic alarm every 25 s prevents
// the SW from sleeping while the sidepanel is open, which would drop pending
// tab messages and cause "Extension not connected" errors.
chrome.alarms.create('sw_keepalive', { periodInMinutes: 25 / 60 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sw_keepalive') {
        // No-op — the alarm firing is enough to keep the service worker alive.
        return;
    }
    if (alarm.name === 'bulk_extraction_keepalive') {
        bulkOrchestrator.handleKeepAliveAlarm();
    }
    if (alarm.name === 'metadata_extraction_keepalive') {
        metadataOrchestrator.handleKeepAliveAlarm();
    }
});

// Recovers from a service-worker restart that happened mid-extraction: closes any tabs
// the interrupted run left open and marks its job 'failed' instead of leaving it stuck
// 'running' forever. See BulkExtractionOrchestrator/MetadataExtractionOrchestrator.checkForRecovery.
async function recoverInterruptedExtractions() {
    await Promise.all([
        bulkOrchestrator.checkForRecovery().catch(e => console.error('[SW] Bulk recovery check failed:', e)),
        metadataOrchestrator.checkForRecovery().catch(e => console.error('[SW] Metadata recovery check failed:', e)),
    ]);
}

// Initialize database on install
chrome.runtime.onInstalled.addListener(async (_) => {
    await db.init();
    await recoverInterruptedExtractions();
});

// The moment host access is granted (via the side panel's connect banner), inject the
// content script into every already-open tab — static manifest content scripts only
// apply to pages loaded afterwards, which is why extractors appeared dead right after
// granting until the user manually reloaded each tab.
chrome.permissions.onAdded.addListener((added) => {
    if (added.origins?.length) {
        injectContentScriptIntoOpenTabs().catch(e =>
            console.error('[SW] Content script injection after permission grant failed:', e));
    }
});

// Initialize database on startup
(async () => {
    await db.init();
    await recoverInterruptedExtractions();
})();

// Set up side panel behavior
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Side panel setup error:', error));


on('BULK_EXTRACTION_START', async (payload) => {
    if (bulkOrchestrator.running) return fail('An extraction is already in progress');
    try {
        return ok(await bulkOrchestrator.start(payload));
    } catch (error) {
        return fail(error);
    }
});

on('BULK_EXTRACTION_STOP', async () => {
    await bulkOrchestrator.stop();
    return ok();
});

on('METADATA_EXTRACTION_START', async (payload) => {
    if (metadataOrchestrator.running) return fail('A metadata extraction is already in progress');
    try {
        return ok(await metadataOrchestrator.start({ ...payload, options: payload.options ?? {} }));
    } catch (error) {
        return fail(error);
    }
});

on('METADATA_EXTRACTION_STOP', async () => {
    await metadataOrchestrator.stop();
    return ok();
});

// Fetches an image for the side panel, bypassing the page's CORS restrictions.
on('DOWNLOAD_IMAGE_PROXY', async ({ url }) => {
    try {
        const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        return ok({ data: Array.from(new Uint8Array(buffer)), contentType: response.headers.get('content-type') || 'image/jpeg' });
    } catch (error) {
        return fail(error, 'Fetch failed');
    }
});

on('DOWNLOAD_VIA_CHROME', async ({ url, filename }) => {
    try {
        const downloadId = await chrome.downloads.download({ url, filename: filename || undefined, saveAs: false });
        return ok({ downloadId });
    } catch (error) {
        return fail(error, 'Download failed');
    }
});
