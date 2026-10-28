/**
 * The crawler backend's API as Pro uses it (`docs/design/LLD.md` §8). The backend team owns it; this is
 * the proposed contract, and `mock.ts` implements it for tests.
 */
import type { MatchRules, PageSource, ReviewState } from '../recipe/types';

export type Schedule = 'once' | 'daily' | 'weekly';

export type CrawlState = 'queued' | 'running' | 'done' | 'failed';

export interface CrawlField {
    name: string;
    /** Share of pages the field was filled on. */
    fill: number;
    /** Share of pages a fallback way (not the first) gave it. */
    fallbackShare?: number;
    failedChecks?: number;
    /** A few pages the field was empty on (proposed: for the repair flow to open). */
    failingPages?: string[];
}

export interface CrawlStatus {
    id: string;
    status: CrawlState;
    pagesDone: number;
    pagesFailed: number;
    fields: CrawlField[];
    /** A few of the newest records. */
    samples: Record<string, unknown>[];
}

/** One way's counts on one day's crawls, over pages that loaded. */
export interface WayDay {
    /** `YYYY-MM-DD`, UTC. */
    date: string;
    /** Pages the way was tried on. */
    tried: number;
    /** Pages it found something on, even when an earlier way already gave the value. */
    matched: number;
    /** Pages its value was the one used. */
    won: number;
}

/** A way's usage by day, by its stable id (`recipe/wayIds.ts`), from every version that had it. */
export interface WayStats {
    field: string;
    wayId: string;
    days: WayDay[];
}

export interface BackendApi {
    createRecipe(input: { name: string; site: string; kind: string; competitor?: string; pageType?: string; matchRules?: MatchRules }): Promise<{ id: string }>;
    /** `file`: a format 3 `.crawlpilot.json` with one version; `digest` makes a repeated upload a no-op. */
    uploadVersion(recipeId: string, file: string, digest: string): Promise<{ version: number; accepted: boolean; errors?: string[] }>;
    /** Records a review of an uploaded version; the backend makes only approved versions live. */
    reviewVersion(recipeId: string, version: number, review: { state: ReviewState; by: string; note: string }): Promise<{ state: ReviewState }>;
    startCrawl(recipeId: string, input: { version: number; pages: PageSource; schedule: Schedule }): Promise<{ crawlId: string }>;
    getCrawl(crawlId: string): Promise<CrawlStatus>;
    setLive(recipeId: string, version: number, reason: string): Promise<{ live: number }>;
    /** Each way's daily usage from `since` (`YYYY-MM-DD`) on. */
    getWayStats(recipeId: string, since: string): Promise<WayStats[]>;
}

export type BackendErrorKind = 'auth' | 'invalid' | 'conflict' | 'unavailable';

export class BackendError extends Error {
    constructor(readonly kind: BackendErrorKind, message: string, readonly status?: number, readonly details?: string[]) {
        super(message);
    }
}
