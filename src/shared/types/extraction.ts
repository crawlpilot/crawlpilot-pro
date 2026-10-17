import { PaginationSpeed } from '../../shared/constants/paginationConfig';

export interface SelectorMetadata {
    selector: string;
    strategy: string;
}

export interface SelectorConfig {
    id: string;
    containerSelector: string; // Primary
    containerSelectors?: SelectorMetadata[];
    containerXPath?: string;
    itemSelector?: string;
    itemSelectors?: SelectorMetadata[];
    itemXPath?: string;
}

export interface SelectorState extends SelectorConfig {
    data: any;
    patternFound: boolean;
    count: number;
    success?: boolean;
    selectionMode?: 'list' | 'single' | 'detail';
    sourceTabId?: number; // [NEW] Track source tab
}

export type PaginationMode = 'auto' | 'pagination' | 'loadMore';

export interface PaginationConfig {
    mode: PaginationMode;
    nextButtonSelector: string | null;
    nextButtonSelectors?: SelectorMetadata[]; // [NEW] Rich fallbacks
    speed?: PaginationSpeed;
    maxPages?: number;
}

export interface ExtractionStatus {
    isExtracting: boolean;
    status: 'idle' | 'running' | 'completed' | 'stopped' | 'failed'; // [NEW] Explicit status
    progress: { id: string; count: number } | null;
    currentPage?: number; // [NEW] Add page tracking
    totalProcessed: number;
    error: string | null;
    /** Rows skipped because an earlier page already had them. */
    duplicates?: number;
    /** Why a listing run ended (see shared/listing/runStats STOP_REASON_LABELS). */
    stopReason?: string;
}


