/**
 * What to do after a failed attempt. Short waits are taken in the worker; long ones (a site cooling down,
 * a backoff past `maxInlineWaitMs`) put the job back on the queue with a delay, so a worker is never held.
 * - Not retryable (404, 410, other 4xx, TLS, robots): the job fails.
 * - No recipe: dead letter, for a person to add one.
 * - Rate limited, blocked, captcha: back on the queue for the site's cooldown, same proxy.
 * - Proxy, connection, timeout, DNS: tried again after a backoff, on another proxy when there is one.
 * - 5xx, empty page, extraction, unknown: tried again after a backoff, same proxy.
 * - Out of attempts (this delivery's and earlier ones'): dead letter.
 */
import type { Classification } from './classify';
import { ProxyPool } from './proxies';
import type { RequestEvent } from './types';

export interface RetryPolicy {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    /** Longer waits put the job back on the queue instead. */
    maxInlineWaitMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 2000, maxDelayMs: 120_000, maxInlineWaitMs: 15_000 };

export type Decision =
    | { action: 'done'; outcome: Extract<RequestEvent['outcome'], 'success' | 'failed' | 'dead_letter'> }
    | { action: 'retry'; waitMs: number; switchProxy: boolean }
    | { action: 'defer'; delayMs: number };

/** Exponential, with jitter: half fixed, half random, so workers that failed together don't retry together. */
export function backoffMs(attempt: number, p: Pick<RetryPolicy, 'baseDelayMs' | 'maxDelayMs'>, random = Math.random): number {
    const cap = Math.min(p.maxDelayMs, p.baseDelayMs * 2 ** (attempt - 1));
    return Math.round(cap / 2 + random() * cap / 2);
}

/**
 * `attempt`: counted over all deliveries of the job, from 1. `siteDeferMs`: the site's cooldown left,
 * when the governor has one.
 */
export function decide(c: Classification, attempt: number, p: RetryPolicy, siteDeferMs?: number, random = Math.random): Decision {
    if (c.errorClass === 'none') return { action: 'done', outcome: 'success' };
    if (c.errorClass === 'no_recipe') return { action: 'done', outcome: 'dead_letter' };
    if (!c.retryable) return { action: 'done', outcome: 'failed' };
    if (attempt >= p.maxAttempts) return { action: 'done', outcome: 'dead_letter' };
    if (c.errorClass === 'rate_limited' || c.errorClass === 'blocked' || c.errorClass === 'captcha') {
        return { action: 'defer', delayMs: Math.max(siteDeferMs ?? 0, c.retryAfterMs ?? 0, backoffMs(attempt, p, random)) };
    }
    const wait = Math.max(c.retryAfterMs ?? 0, backoffMs(attempt, p, random));
    if (wait > p.maxInlineWaitMs || c.errorClass === 'recipe_store') return { action: 'defer', delayMs: wait };
    return { action: 'retry', waitMs: wait, switchProxy: ProxyPool.isProxyFault(c.errorClass) };
}
