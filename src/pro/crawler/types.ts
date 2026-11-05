/**
 * The crawler worker's messages and documents (`docs/design/crawler.md`): the job it takes, the records it
 * writes to Elasticsearch (one scrape and one selector-usage document per page, one request event per
 * attempt) and how a failure is classed.
 */

/** One URL to crawl, as the queue delivers it. */
export interface CrawlJob {
    /** Idempotency: a redelivered job overwrites its documents, never duplicates them. */
    jobId: string;
    url: string;
    competitor: string;
    pageType: string;
    /** Pin a version by its digest instead of resolving `live`. */
    recipeDigest?: string;
    /** `test` writes to the test indices only, and may run a version not yet approved. */
    mode?: 'prod' | 'test';
    /** Groups the jobs of one batch, for health per run. */
    runId?: string;
    /** Passed through to the scrape document as is. */
    meta?: Record<string, string>;
    /**
     * The values of the recipe's variables (`{zip}`, `{store}`): where its session setup puts the browser.
     * Its documents carry it, and their ids include it, so one URL read for two locations is two documents.
     */
    context?: Record<string, string>;
    /** Attempts already made by earlier deliveries (set by the worker when it puts a job back). */
    attempts?: number;
    /** Times the recipe store failed this job in a row: its wait grows, its attempts don't. */
    storeFailures?: number;
    /** Not to be run before this time (epoch ms): set when a job is put back for longer than a queue can delay it. */
    notBefore?: number;
    /** Times Elasticsearch did not confirm the job's documents in a row: past a few, the job is dead-lettered. */
    writeFailures?: number;
    /** When a worker first took the job (epoch ms), set when it is first put back: past `retry.maxJobAgeMs` it is given up on. */
    firstSeenAt?: number;
    /** A list's page number, from 1: its next page is a job of its own. */
    page?: number;
    /** A list row's details page: run with the version's details recipe, and joined to its row by `parent`. */
    part?: 'details';
    parent?: { jobId: string; listId: string; row: number };
}

export type PageStatus = 'ok' | 'blocked' | 'not_found' | 'timeout' | 'error';

/** Why an attempt failed, or `none`. Each class has a fixed retry rule and outcome (`classify.ts`). */
export type ErrorClass =
    | 'none'
    | 'dns' | 'connection' | 'tls' | 'timeout' | 'navigation'
    /** The worker's browser or its context died: not the page's fault, not counted against the job. */
    | 'browser'
    /** The page crashed its tab (out of memory, a renderer crash): the page's, counted. */
    | 'page_crashed'
    | 'proxy' | 'proxy_auth'
    | 'rate_limited' | 'blocked' | 'captcha'
    /** A waiting room (Queue-it): the site lets visitors in in turn; waited out like a rate limit. */
    | 'waiting_room'
    | 'not_found' | 'gone' | 'client_error' | 'server_error'
    | 'empty_page' | 'robots_disallowed'
    | 'extraction' | 'no_recipe' | 'recipe_store' | 'paused'
    /** A session setup or action step failed: its element not found, or the setup check not met. */
    | 'setup_failed'
    /** The job lacks a value the recipe's steps need (`context.zip`): dead-lettered, for a person to fix the job. */
    | 'missing_context'
    /** The job was put back for longer than `retry.maxJobAgeMs` (a site that stays blocked): dead-lettered. */
    | 'expired'
    | 'unknown';

/** The recipe version a page was read with: every value traces back to the reviewed version. */
export interface RecipeRef {
    recipeId: string;
    version: number;
    digest: string;
}

export interface ScrapeDoc extends RecipeRef {
    jobId: string;
    runId?: string;
    url: string;
    finalUrl: string;
    competitor: string;
    pageType: string;
    mode: 'prod' | 'test';
    crawledAt: string;
    pageStatus: PageStatus;
    /** Field name → cleaned, typed value. */
    attributes: Record<string, unknown>;
    fieldStatus: Record<string, 'ok' | 'empty' | 'check_failed'>;
    meta?: Record<string, string>;
    /** The job's context: the location (or other values) the page was read for. */
    context?: Record<string, string>;
    /** A list row: its list, its place on the page, and the page. */
    listId?: string;
    row?: number;
    page?: number;
    /** A details page: the list row it belongs to. */
    parent?: { jobId: string; listId: string; row: number };
}

export interface SelectorUsageDoc extends RecipeRef {
    jobId: string;
    crawledAt: string;
    competitor: string;
    pageType: string;
    pageStatus: PageStatus;
    context?: Record<string, string>;
    ways: { field: string; wayId: string; tried: boolean; matched: boolean; won: boolean }[];
}

/** One attempt at one URL: what was asked, what came back, through which proxy, and what it meant. */
export interface RequestEvent {
    '@timestamp': string;
    jobId: string;
    runId?: string;
    attempt: number;
    /** The last attempt of this delivery: its outcome is the job's. */
    final: boolean;
    outcome: 'success' | 'retry' | 'deferred' | 'failed' | 'dead_letter';
    url: string;
    finalUrl?: string;
    host: string;
    competitor: string;
    pageType: string;
    mode: 'prod' | 'test';
    worker: string;
    proxyId?: string;
    proxyCountry?: string;
    status?: number;
    /** Selected response headers (`classify.ts` KEEP_HEADERS); values of others are not kept. */
    headers?: Record<string, string>;
    /** Every response header name, for telling block pages apart. */
    headerNames?: string[];
    requestHeaders?: Record<string, string>;
    redirects?: string[];
    timings: { totalMs: number; navigationMs?: number; extractMs?: number };
    bytes?: number;
    errorClass: ErrorClass;
    errorMessage?: string;
    /** What gave a block away ("status 403 + cf-mitigated: challenge"). */
    blockSignal?: string;
    /** The block identified (`detect.ts`): its vendor, kind (challenge, captcha, block, rate_limit, queue, soft_block) and confidence. */
    blockVendor?: string;
    blockKind?: string;
    blockConfidence?: 'high' | 'medium' | 'low';
    /** Bot protection vendors seen on the response, blocked or not: which sites use what. */
    protection?: string[];
    /** On a block: what the page showed, for a person checking the identification. */
    blockEvidence?: { title?: string; textSample?: string; resourceHosts?: string[]; cookieNames?: string[] };
    /** Length of the page's visible text. */
    textLength?: number;
    /** The job's context (`{zip}`…). */
    context?: Record<string, string>;
    /** The recipe's session setup on this attempt: whether it ran, how long it took, and the step that failed. */
    setup?: { ran: boolean; ms: number; failedStep?: string };
    retryAfterMs?: number;
    /** How long the worker waits before the next attempt, when there is one. */
    nextAttemptInMs?: number;
    recipe?: RecipeRef;
    fieldsFilled?: number;
    fieldsTotal?: number;
    /** A list page: rows read, pages read here (clicked or loaded more), and jobs it led to. */
    rows?: number;
    listPages?: number;
    followUps?: number;
}

/** A site's state changing: cooling down, blocked, or back to normal. For people to follow up. */
export interface SiteEvent {
    '@timestamp': string;
    host: string;
    competitor?: string;
    worker: string;
    state: 'ok' | 'cooldown' | 'blocked';
    reason: string;
    /** The block's vendor, kind and confidence (`detect.ts`), when a block moved the site. */
    vendor?: string;
    blockKind?: string;
    blockConfidence?: string;
    consecutiveBlocks: number;
    delayMs: number;
    cooldownUntil?: string;
}
