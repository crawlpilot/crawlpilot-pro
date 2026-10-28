/**
 * robots.txt, when a site's policy says to respect it (the default). The group for our user agent token,
 * else `*`; within it the longest matching `Allow` or `Disallow` wins, `Allow` on a tie; `*` matches any
 * run of characters and a trailing `$` anchors the end (RFC 9309). No file (4xx) means no rules; a file
 * that can't be read (5xx, unreachable) allows for now and is tried again sooner. Cached per origin.
 */

interface Rule { allow: boolean; pattern: string; re: RegExp }

export interface Robots {
    allowed(url: string): boolean;
}

function toRegExp(pattern: string): RegExp {
    const anchored = pattern.endsWith('$');
    const body = (anchored ? pattern.slice(0, -1) : pattern).split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function parseRobots(text: string, agent: string): Robots {
    const groups: { agents: string[]; rules: Rule[] }[] = [];
    let current: { agents: string[]; rules: Rule[] } | null = null;
    let lastWasAgent = false;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trim();
        const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
        if (!m) continue;
        const [key, value] = [m[1].toLowerCase(), m[2].trim()];
        if (key === 'user-agent') {
            if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
            current.agents.push(value.toLowerCase());
            lastWasAgent = true;
            continue;
        }
        lastWasAgent = false;
        if (!current || (key !== 'allow' && key !== 'disallow')) continue;
        if (key === 'disallow' && value === '') continue;
        current.rules.push({ allow: key === 'allow', pattern: value, re: toRegExp(value) });
    }
    const token = agent.toLowerCase();
    const mine = groups.filter(g => g.agents.some(a => a !== '*' && token.includes(a)));
    const rules = (mine.length ? mine : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules);
    return {
        allowed(url) {
            let path: string;
            try { const u = new URL(url); path = u.pathname + u.search; } catch { return true; }
            let best: Rule | undefined;
            for (const r of rules) {
                if (!r.re.test(path)) continue;
                if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
            }
            return !best || best.allow;
        },
    };
}

const ALLOW_ALL: Robots = { allowed: () => true };

/**
 * robots.txt per origin, read with `fetchText` (the worker passes one that goes through the page's proxy).
 * A 4xx means no rules; a 5xx or an unreachable file is retried after `retryMs` and, until then, allows.
 */
export class RobotsCache {
    private cache = new Map<string, { at: number; ttl: number; robots: Robots }>();

    constructor(
        private agent: string,
        private fetchText: (url: string) => Promise<{ status: number; text: string }>,
        private ttlMs = 3_600_000,
        private retryMs = 300_000,
        private now: () => number = Date.now,
    ) {}

    async allowed(url: string): Promise<boolean> {
        let origin: string;
        try { origin = new URL(url).origin; } catch { return true; }
        let hit = this.cache.get(origin);
        if (!hit || this.now() - hit.at > hit.ttl) {
            let robots = ALLOW_ALL, ttl = this.ttlMs;
            try {
                const { status, text } = await this.fetchText(`${origin}/robots.txt`);
                if (status >= 200 && status < 300) robots = parseRobots(text, this.agent);
                else if (status >= 500) ttl = this.retryMs;
            } catch {
                ttl = this.retryMs;
            }
            hit = { at: this.now(), ttl, robots };
            this.cache.set(origin, hit);
        }
        return hit.robots.allowed(url);
    }
}
