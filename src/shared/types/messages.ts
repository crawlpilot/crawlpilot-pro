// Message types for communication between extension components

export type MessageType =
    | 'AUTOMATION_START'
    | 'AUTOMATION_STOP'
    | 'AUTOMATION_STATUS'
    | 'DATA_SAVED'
    | 'EXTRACTION_COMPLETE'
    | 'PING'
    | 'AUTO_SCROLL_UPDATE'
    | 'AUTO_SCROLL_STATUS'
    | 'AUTO_SCROLL_COMPLETE'
    | 'EXECUTE_AUTO_SCROLL'
    | 'STOP_AUTO_SCROLL'
    | 'ELEMENT_SELECTED'
    | 'START_PICKER'
    | 'STOP_PICKER'
    | 'EXECUTE_PAGINATION'
    | 'STOP_PAGINATION'
    | 'PAGINATION_UPDATE'
    | 'PAGINATION_STATUS'
    | 'PAGINATION_COMPLETE'
    | 'OPEN_DATA_VIEWER'
    | 'PICKER_CANCELLED'
    | 'CMD_EXTRACT_PAGE_BACKGROUND'
    | 'CMD_PAGINATION_ACTION'
    | 'TEST_SELECTOR'
    | 'AUTH_SUCCESS'
    | 'AUTH_LOGOUT'
    | 'SCAN_IMAGES'
    | 'SCAN_IMAGES_DEEP'
    | 'SCAN_IMAGES_DEEP_CANCEL'
    | 'SCAN_IMAGES_PROGRESS'
    | 'SCAN_IMAGES_BATCH'
    | 'SCAN_IMAGES_LIVE_START'
    | 'SCAN_IMAGES_LIVE_STOP'
    | 'DOWNLOAD_IMAGE_PROXY'
    | 'DOWNLOAD_VIA_CHROME'
    | 'BULK_EXTRACTION_START'
    | 'BULK_EXTRACTION_STOP'
    | 'BULK_EXTRACTION_PROGRESS'
    | 'BULK_EXTRACTION_COMPLETE'
    | 'METADATA_EXTRACTION_START'
    | 'METADATA_EXTRACTION_STOP'
    | 'METADATA_EXTRACTION_PROGRESS'
    | 'METADATA_EXTRACTION_COMPLETE'
    | 'CMD_EXTRACT_METADATA';

export interface BaseMessage {
    type: MessageType;
    timestamp?: number;
}

export interface AutomationStartMessage extends BaseMessage {
    type: 'AUTOMATION_START';
    payload: {
        automationId: number;
        type: string;
        config: any;
    };
}

export interface AutomationStopMessage extends BaseMessage {
    type: 'AUTOMATION_STOP';
    payload: {
        automationId: number;
    };
}

export interface AutomationStatusMessage extends BaseMessage {
    type: 'AUTOMATION_STATUS';
    payload: {
        automationId: number;
        status: string;
        progress?: {
            current: number;
            total: number;
        };
    };
}

export interface DataSavedMessage extends BaseMessage {
    type: 'DATA_SAVED';
    payload: {
        tableDataId: number;
    };
}

export interface DownloadImageProxyMessage extends BaseMessage {
    type: 'DOWNLOAD_IMAGE_PROXY';
    payload: { url: string };
}

export interface DownloadViaChromeMessage extends BaseMessage {
    type: 'DOWNLOAD_VIA_CHROME';
    payload: { url: string; filename?: string };
}

export interface ExtractionCompleteMessage extends BaseMessage {
    type: 'EXTRACTION_COMPLETE';
    payload: {
        data: any;
        tableDataId?: number;
    };
}



export interface BulkExtractionStartMessage extends BaseMessage {
    type: 'BULK_EXTRACTION_START';
    payload: {
        urls: string[];
        elements: any[];
        config: any;
        jobId?: number;
        recipeId?: number;
        customName?: string;
        maxConcurrent?: number;
    };
}

export interface BulkExtractionStopMessage extends BaseMessage {
    type: 'BULK_EXTRACTION_STOP';
    payload: {
        jobId?: number;
    };
}

export interface BulkExtractionProgressMessage extends BaseMessage {
    type: 'BULK_EXTRACTION_PROGRESS';
    payload: {
        jobId: number;
        completedUrls: number;
        totalUrls: number;
        currentUrl?: string;
        activeTabs: number;
        urlStatuses: Array<{ url: string; status: 'queued' | 'extracting' | 'done' | 'error'; error?: string }>;
        previewTableId?: number | null;
    };
}

export interface BulkExtractionCompleteMessage extends BaseMessage {
    type: 'BULK_EXTRACTION_COMPLETE';
    payload: {
        jobId: number;
        tableDataId?: number;
        totalItems: number;
        success: boolean;
        error?: string;
        stoppedByUser?: boolean;
    };
}

import type { MetadataExtractOptions } from './metadata';

export interface MetadataExtractionStartMessage extends BaseMessage {
    type: 'METADATA_EXTRACTION_START';
    payload: {
        urls: string[];
        options: MetadataExtractOptions;
        maxConcurrent?: number;
        requestDelay?: number;
        loadTimeout?: number;
        customName?: string;
    };
}

export interface MetadataExtractionStopMessage extends BaseMessage {
    type: 'METADATA_EXTRACTION_STOP';
    payload?: { jobId?: number };
}

export interface MetadataExtractionProgressMessage extends BaseMessage {
    type: 'METADATA_EXTRACTION_PROGRESS';
    payload: {
        jobId: number;
        completedUrls: number;
        totalUrls: number;
        activeTabs: number;
        urlStatuses: Array<{ url: string; status: 'queued' | 'extracting' | 'done' | 'error'; error?: string }>;
        previewTableId?: number | null;
    };
}

export interface MetadataExtractionCompleteMessage extends BaseMessage {
    type: 'METADATA_EXTRACTION_COMPLETE';
    payload: {
        jobId: number;
        tableDataId?: number;
        totalItems: number;
        success: boolean;
        error?: string;
        stoppedByUser?: boolean;
    };
}

export type Message =
    | AutomationStartMessage
    | AutomationStopMessage
    | AutomationStatusMessage
    | DataSavedMessage
    | ExtractionCompleteMessage
    | BulkExtractionStartMessage
    | BulkExtractionStopMessage
    | BulkExtractionProgressMessage
    | BulkExtractionCompleteMessage
    | MetadataExtractionStartMessage
    | MetadataExtractionStopMessage
    | MetadataExtractionProgressMessage
    | MetadataExtractionCompleteMessage
    | DownloadImageProxyMessage
    | DownloadViaChromeMessage
    | BaseMessage;
