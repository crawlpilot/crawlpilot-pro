/**
 * `chrome.storage.local`: per-device settings and the state a run needs to survive a page load or a
 * service-worker restart. Each key is defined once here with its type; nothing else names a key.
 * Records (recipes, jobs, tables) live in IndexedDB (`shared/db`).
 */
import type { PaginationRequest } from './messages';

/** Export targets set in Settings → Integrations. */
export interface Integrations {
    webhookUrl: string;
    zapierUrl: string;
    airtableApiKey: string;
    airtableBaseId: string;
    airtableTableName: string;
    /** The user's own spreadsheet, connected through its Apps Script web app (`shared/integrations/sheets.ts`). */
    sheets?: import('./integrations/sheets').SheetsConnection;
}

export const DEFAULT_INTEGRATIONS: Integrations = {
    webhookUrl: '',
    zapierUrl: '',
    airtableApiKey: '',
    airtableBaseId: '',
    airtableTableName: '',
};

/** A background run in progress, so a restarted service worker can close its tabs and fail its job. */
export interface RunRecovery {
    jobId: number;
    isRunning: boolean;
    urlStatuses: { url: string; status: string; tabId?: number }[];
}

/** A pagination run about to click "Next": the next page's content script continues from here. */
export interface PaginationResume {
    config: PaginationRequest;
    pageCount: number;
    totalItems: number;
    visitedUrls: string[];
    isRunning: boolean;
    timestamp: number;
}

export type Appearance = 'light' | 'dark' | 'system';

interface StorageSchema {
    /** The UI language chosen in Settings ('' follows the browser). */
    language: string;
    /** Light (the default), dark, or whatever the system uses. */
    appearance: Appearance;
    integrations: Integrations;
    bulk_extraction_state: RunRecovery;
    metadata_extraction_state: RunRecovery;
    contacts_extraction_state: RunRecovery;
    pagination_state: PaginationResume;
    /** Page assistant, "Does it fit me?": what matters to the user, in their words (kept on this device). */
    assistantNeeds: string;
}

export type StorageKey = keyof StorageSchema;

async function get<K extends StorageKey>(key: K): Promise<StorageSchema[K] | undefined> {
    const found = await chrome.storage.local.get([key]);
    return found[key] as StorageSchema[K] | undefined;
}

async function set<K extends StorageKey>(key: K, value: StorageSchema[K]): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
}

async function remove(key: StorageKey): Promise<void> {
    await chrome.storage.local.remove(key);
}

export const storage = { get, set, remove };
