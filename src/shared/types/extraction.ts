import type { ListAlternative } from '../messages';
import { PaginationSpeed } from '../../shared/constants/paginationConfig';
import type { Chain } from './database';

/** One list picked in the List Extractor: the same chains a list recipe stores (`ListTarget`). */
export interface ListPick {
    id: string;
    /** The list's container, best first. */
    container: Chain;
    /** Its items, relative to the container, best first. */
    items: Chain;
    /** The preview read at pick time: `columns` (the frozen fields, with readers) and `items`. */
    data: any;
    /** False for a single element picked in list mode (read like one item). */
    patternFound: boolean;
    count: number;
    /** The tab it was picked in: the run goes back to it. */
    sourceTabId?: number;
    /** What the list is ("Results · 18 items") and its kind. */
    label?: string;
    kind?: ListAlternative['kind'];
    /** The page's other lists of the same items (a sponsored shelf, a carousel), to switch to. */
    alternatives?: ListAlternative[];
}

export type PaginationMode = 'auto' | 'pagination' | 'loadMore';

export interface PaginationConfig {
    mode: PaginationMode;
    /** The Next / Load more control, best first (empty for infinite scroll). */
    next: Chain;
    speed?: PaginationSpeed;
    maxPages?: number;
}

export interface ExtractionStatus {
    isExtracting: boolean;
    status: 'idle' | 'running' | 'completed' | 'stopped' | 'failed';
    progress: { id: string; count: number } | null;
    currentPage?: number;
    totalProcessed: number;
    error: string | null;
    /** Rows skipped because an earlier page already had them. */
    duplicates?: number;
    /** Why a listing run ended (see shared/listing/runStats STOP_REASON_LABELS). */
    stopReason?: string;
}


