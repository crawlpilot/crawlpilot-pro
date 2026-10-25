/**
 * The crawler backend's API as Pro uses it (`docs/design/LLD.md` §8). The backend team owns it; this is
 * the proposed contract, and `mock.ts` implements it for tests.
 */
import type { PageSource } from '../recipe/types';

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

export interface BackendApi {
    createRecipe(input: { name: string; site: string; kind: string }): Promise<{ id: string }>;
    /** `file`: a format 2 `.crawlpilot.json` with one version; `digest` makes a repeated upload a no-op. */
    uploadVersion(recipeId: string, file: string, digest: string): Promise<{ version: number; accepted: boolean; errors?: string[] }>;
    startCrawl(recipeId: string, input: { version: number; pages: PageSource; schedule: Schedule }): Promise<{ crawlId: string }>;
    getCrawl(crawlId: string): Promise<CrawlStatus>;
    setLive(recipeId: string, version: number, reason: string): Promise<{ live: number }>;
}

export type BackendErrorKind = 'auth' | 'invalid' | 'conflict' | 'unavailable';

export class BackendError extends Error {
    constructor(readonly kind: BackendErrorKind, message: string, readonly status?: number, readonly details?: string[]) {
        super(message);
    }
}
