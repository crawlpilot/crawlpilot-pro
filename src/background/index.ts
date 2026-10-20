import { db } from '../shared/db';
import { fail, ok, on } from '../shared/messages';
import { injectContentScriptIntoOpenTabs } from '../shared/utils/hostPermissions';
import { JobRunner } from './runs/JobRunner';
import { bulkJob } from './runs/bulkJob';
import { metadataJob } from './runs/metadataJob';
import { contactsJob } from './runs/contactsJob';
import { apiJob } from './runs/apiJob';

const bulkRuns = new JobRunner('bulk');
const metadataRuns = new JobRunner('metadata');
const contactsRuns = new JobRunner('contacts');
const apiRuns = new JobRunner('api');

// MV3 service workers idle out after ~30 s. Periodic alarms (this one, and each run's own while it
// runs) keep the worker alive: the alarm firing is enough, the listener has nothing to do.
chrome.alarms.create('sw_keepalive', { periodInMinutes: 25 / 60 });
chrome.alarms.onAlarm.addListener(() => undefined);

// A run cut off by a service-worker restart: close its tabs and fail its job instead of leaving it 'running'.
async function recoverInterruptedExtractions() {
    await Promise.all([
        bulkRuns.recover().catch(e => console.error('[SW] Bulk recovery check failed:', e)),
        metadataRuns.recover().catch(e => console.error('[SW] Metadata recovery check failed:', e)),
        contactsRuns.recover().catch(e => console.error('[SW] Contacts recovery check failed:', e)),
        apiRuns.recover().catch(e => console.error('[SW] API recovery check failed:', e)),
    ]);
}

// Initialize database on install
chrome.runtime.onInstalled.addListener(async (_) => {
    await db.open();
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
    await db.open();
    await recoverInterruptedExtractions();
})();

// Set up side panel behavior
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Side panel setup error:', error));


// The clock for a run's page waits (`content/utils/clock.ts`): a hidden tab's own timers are throttled.
on('RUN_SLEEP', ({ ms }) => new Promise(resolve => setTimeout(() => resolve(ok()), Math.max(0, Math.min(Number(ms) || 0, 5000)))));

on('BULK_EXTRACTION_START', async (payload) => {
    try {
        return ok(await bulkRuns.start(bulkJob(payload)));
    } catch (error) {
        return fail(error);
    }
});

on('BULK_EXTRACTION_STOP', async () => ok({ running: await bulkRuns.stop() }));

on('METADATA_EXTRACTION_START', async (payload) => {
    try {
        return ok(await metadataRuns.start(metadataJob(payload)));
    } catch (error) {
        return fail(error);
    }
});

on('METADATA_EXTRACTION_STOP', async () => ok({ running: await metadataRuns.stop() }));

on('CONTACTS_START', async (payload) => {
    try {
        return ok(await contactsRuns.start(contactsJob(payload)));
    } catch (error) {
        return fail(error);
    }
});

on('CONTACTS_STOP', async () => ok({ running: await contactsRuns.stop() }));

on('API_START', async (payload) => {
    try {
        return ok(await apiRuns.start(apiJob(payload)));
    } catch (error) {
        return fail(error);
    }
});

on('API_STOP', async () => ok({ running: await apiRuns.stop() }));

// Fetches an image for the side panel, bypassing the page's CORS restrictions.
