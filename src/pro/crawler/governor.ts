/**
 * How fast each site is crawled, and what a block does to that: a circuit breaker per host.
 * - Requests start at least `delayMs` apart, at most `concurrency` at once.
 * - 429 (or a vendor's rate-limit page): the gap doubles and the site cools down for `Retry-After`, or the
 *   gap, whichever is longer.
 * - A waiting room (Queue-it): the site cools down for `cooldownBaseMs` (or `Retry-After`); the gap stays.
 * - A block or captcha: the gap doubles and the site cools down, longer for each block in a row; after
 *   `blockAfter` in a row it is `blocked`, for `cooldownMaxMs`, and an event asks a person to look.
 * - 5xx: the gap grows by half; the site may be struggling.
 * - When a cooldown ends, one request at a time goes first; a success puts the site back to `ok`, and
 *   each success shortens the gap a little, down to `minDelayMs`.
 * Blocks are resolved by slowing down and waiting, never by changing who is asking.
 */
import type { Classification } from './classify';
import type { SiteEvent } from './types';

export interface SitePolicy {
    minDelayMs: number;
    maxDelayMs: number;
    concurrency: number;
    cooldownBaseMs: number;
    cooldownMaxMs: number;
    /** Blocks in a row before the site is `blocked`. */
    blockAfter: number;
}

export const DEFAULT_SITE_POLICY: SitePolicy = {
    minDelayMs: 2000, maxDelayMs: 60_000, concurrency: 2,
    cooldownBaseMs: 60_000, cooldownMaxMs: 3_600_000, blockAfter: 3,
};

interface SiteState {
    state: 'ok' | 'cooldown' | 'blocked';
    delayMs: number;
    nextAt: number;
    inFlight: number;
    cooldownUntil: number;
    consecutiveBlocks: number;
}

/** Start now after `waitMs`, or put the job back for `deferMs`. */
export type Slot = { waitMs: number } | { deferMs: number; reason: string };

export class SiteGovernor {
    private sites = new Map<string, SiteState>();

    constructor(
        private policyOf: (host: string) => SitePolicy,
        private onEvent: (e: Omit<SiteEvent, '@timestamp' | 'worker'>) => void = () => {},
        private now: () => number = Date.now,
    ) {}

    private site(host: string): SiteState {
        let s = this.sites.get(host);
        if (!s) {
            s = { state: 'ok', delayMs: this.policyOf(host).minDelayMs, nextAt: 0, inFlight: 0, cooldownUntil: 0, consecutiveBlocks: 0 };
            this.sites.set(host, s);
        }
        return s;
    }

    /** Reserves the host's next start, or says to put the job back. Every reservation is ended with `done`. */
    reserve(host: string): Slot {
        const s = this.site(host);
        const now = this.now();
        if (s.state !== 'ok' && now < s.cooldownUntil) return { deferMs: s.cooldownUntil - now, reason: s.state };
        // Coming out of a cooldown: one request at a time until one succeeds.
        const limit = s.state === 'ok' ? this.policyOf(host).concurrency : 1;
        if (s.inFlight >= limit) return { deferMs: Math.max(250, s.nextAt - now), reason: 'busy' };
        const start = Math.max(now, s.nextAt);
        s.nextAt = start + s.delayMs;
        s.inFlight++;
        return { waitMs: start - now };
    }

    /** Ends a reservation with what the attempt came to. */
    done(host: string, c: Classification): void {
        const s = this.site(host);
        const p = this.policyOf(host);
        const now = this.now();
        s.inFlight = Math.max(0, s.inFlight - 1);
        switch (c.errorClass) {
            case 'none':
            case 'not_found':
            case 'gone':
                s.consecutiveBlocks = 0;
                s.delayMs = Math.max(p.minDelayMs, Math.round(s.delayMs * 0.9));
                if (s.state !== 'ok') this.move(host, s, 'ok', 'a request succeeded');
                return;
            case 'rate_limited':
                s.delayMs = Math.min(p.maxDelayMs, s.delayMs * 2);
                s.cooldownUntil = now + Math.max(c.retryAfterMs ?? 0, s.delayMs);
                if (s.state === 'ok') this.move(host, s, 'cooldown', `rate limited${c.blockSignal ? `: ${c.blockSignal}` : ''}`, c);
                return;
            case 'waiting_room':
                s.cooldownUntil = now + Math.max(c.retryAfterMs ?? 0, p.cooldownBaseMs);
                if (s.state === 'ok') this.move(host, s, 'cooldown', `waiting room${c.blockSignal ? `: ${c.blockSignal}` : ''}`, c);
                return;
            case 'blocked':
            case 'captcha': {
                s.consecutiveBlocks++;
                s.delayMs = Math.min(p.maxDelayMs, s.delayMs * 2);
                const blocked = s.consecutiveBlocks >= p.blockAfter;
                const wait = blocked ? p.cooldownMaxMs : Math.min(p.cooldownMaxMs, p.cooldownBaseMs * 2 ** (s.consecutiveBlocks - 1));
                s.cooldownUntil = now + wait;
                this.move(host, s, blocked ? 'blocked' : 'cooldown', `${c.errorClass}${c.blockSignal ? `: ${c.blockSignal}` : ''}`, c);
                return;
            }
            case 'server_error':
                s.delayMs = Math.min(p.maxDelayMs, Math.round(s.delayMs * 1.5));
                return;
            default:
                return;
        }
    }

    stateOf(host: string): Readonly<SiteState> {
        return { ...this.site(host) };
    }

    private move(host: string, s: SiteState, state: SiteState['state'], reason: string, c?: Classification) {
        s.state = state;
        this.onEvent({
            host, state, reason,
            ...(c?.block ? { vendor: c.block.vendor, blockKind: c.block.kind, blockConfidence: c.block.confidence } : {}), consecutiveBlocks: s.consecutiveBlocks, delayMs: s.delayMs,
            ...(state !== 'ok' ? { cooldownUntil: new Date(s.cooldownUntil).toISOString() } : {}),
        });
    }
}
