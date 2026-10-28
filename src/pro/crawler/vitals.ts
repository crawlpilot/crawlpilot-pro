/**
 * Whether the worker is well, for the process to act on:
 * - `unhealthy`: the browser failed this many times in a row (it keeps crashing, or can't start): better a
 *   fresh task than a worker that fails every job;
 * - `alive`: jobs are moving. A worker with jobs in flight but none settled for `stuckMs` is wedged, and a
 *   container health check should replace it (`cli.ts` writes a heartbeat only while alive).
 */
export class Vitals {
    private browserFailuresInARow = 0;
    private lastProgress: number;

    constructor(private maxBrowserFailures = 5, private stuckMs = 15 * 60_000, private now: () => number = Date.now) {
        this.lastProgress = now();
    }

    browserFailed() { this.browserFailuresInARow++; }
    browserWorked() { this.browserFailuresInARow = 0; }
    /** A job settled. */
    progressed() { this.lastProgress = this.now(); }

    get unhealthy() { return this.browserFailuresInARow >= this.maxBrowserFailures; }

    alive(inFlight: number): boolean {
        return !this.unhealthy && (inFlight === 0 || this.now() - this.lastProgress < this.stuckMs);
    }
}
