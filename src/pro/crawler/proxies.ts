/**
 * Proxy pools. A host keeps the same proxy while it works, so a site sees one steady visitor per pool. A
 * proxy that fails at the proxy's end (it refuses, times out, or rejects its credentials) is set aside for
 * a while and the host moves to another healthy one. A block by the site is not a proxy failure: it never
 * moves the host to another proxy (see `governor.ts`).
 * Credentials never leave this module except into the browser's proxy settings: events carry the id.
 */
import type { ErrorClass } from './types';

export interface ProxyConfig {
    id: string;
    /** `http://host:port` or `socks5://host:port`. */
    server: string;
    username?: string;
    password?: string;
    /** Where it exits, for sites that need a market's view (ISO 3166 alpha-2). */
    country?: string;
    /** Chromium's proxy bypass list; `<-loopback>` sends even local addresses through the proxy (tests). */
    bypass?: string;
}

interface Health {
    failures: number;
    downUntil: number;
    uses: number;
}

/** Failures at the proxy's end; anything else says nothing about the proxy. */
const PROXY_FAULTS = new Set<ErrorClass>(['proxy', 'proxy_auth', 'connection', 'timeout', 'dns']);

export class ProxyPool {
    private health = new Map<string, Health>();
    private byHost = new Map<string, string>();

    constructor(
        private proxies: ProxyConfig[],
        private opts: { downMs: number; failuresToDown: number } = { downMs: 300_000, failuresToDown: 2 },
        private now: () => number = Date.now,
    ) {
        for (const p of proxies) this.health.set(p.id, { failures: 0, downUntil: 0, uses: 0 });
    }

    get size() { return this.proxies.length; }

    private healthy(p: ProxyConfig) { return this.health.get(p.id)!.downUntil <= this.now(); }

    /**
     * The host's proxy: its current one while healthy, else the least used healthy one in the country.
     * `exclude`: proxies this job already failed on at the proxy's end.
     */
    pick(host: string, country?: string, exclude: ReadonlySet<string> = new Set()): ProxyConfig | undefined {
        const fits = this.proxies.filter(p => (!country || p.country === country) && !exclude.has(p.id));
        const current = fits.find(p => p.id === this.byHost.get(host));
        const chosen = current && this.healthy(current) ? current
            : fits.filter(p => this.healthy(p)).sort((a, b) => this.health.get(a.id)!.uses - this.health.get(b.id)!.uses)[0];
        if (!chosen) return undefined;
        this.byHost.set(host, chosen.id);
        this.health.get(chosen.id)!.uses++;
        return chosen;
    }

    /** Records an attempt through a proxy. Returns true when the proxy was set aside. */
    report(id: string, errorClass: ErrorClass): boolean {
        const h = this.health.get(id);
        if (!h) return false;
        if (!PROXY_FAULTS.has(errorClass)) {
            if (errorClass === 'none') h.failures = 0;
            return false;
        }
        h.failures++;
        if (errorClass === 'proxy_auth' || h.failures >= this.opts.failuresToDown) {
            h.downUntil = this.now() + this.opts.downMs;
            h.failures = 0;
            return true;
        }
        return false;
    }

    /** Whether a failure of this class may move the request to another proxy. */
    static isProxyFault(errorClass: ErrorClass) { return PROXY_FAULTS.has(errorClass); }
}
