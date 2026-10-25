/**
 * robots.txt parsing and matching (RFC 9309): groups by user-agent, longest-match wins, Allow beats
 * Disallow on a tie, `*` wildcards and `$` end anchors. Used to *warn*, never to block a run.
 */

export interface RobotsRule {
    allow: boolean;
    path: string;
}

export interface RobotsGroup {
    agents: string[];
    rules: RobotsRule[];
    crawlDelay?: number;
}

export interface ParsedRobots {
    groups: RobotsGroup[];
    sitemaps: string[];
}

export interface RobotsDecision {
    allowed: boolean;
    /** The rule that decided, e.g. "Disallow: /search"; empty when nothing matched. */
    rule: string;
    crawlDelay?: number;
}

export function parseRobots(text: string): ParsedRobots {
    const groups: RobotsGroup[] = [];
    const sitemaps: string[] = [];
    let current: RobotsGroup | null = null;
    let lastWasAgent = false;

    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trim();
        if (!line) continue;
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();

        if (key === 'sitemap') {
            if (value) sitemaps.push(value);
            continue;
        }
        if (key === 'user-agent') {
            if (!current || !lastWasAgent) {
                current = { agents: [], rules: [] };
                groups.push(current);
            }
            current.agents.push(value.toLowerCase());
            lastWasAgent = true;
            continue;
        }
        lastWasAgent = false;
        if (!current) continue;
        if (key === 'allow' || key === 'disallow') {
            // An empty Disallow means "allow everything": no rule to add.
            if (value) current.rules.push({ allow: key === 'allow', path: value });
        } else if (key === 'crawl-delay') {
            const n = parseFloat(value);
            if (!Number.isNaN(n)) current.crawlDelay = n;
        }
    }
    return { groups, sitemaps };
}

function ruleMatches(rulePath: string, path: string): boolean {
    const anchored = rulePath.endsWith('$');
    const body = anchored ? rulePath.slice(0, -1) : rulePath;
    const pattern = body.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
}

/** Picks the group for `agent` (most specific name match, else `*`). */
function groupFor(robots: ParsedRobots, agent: string): RobotsGroup[] {
    const ua = agent.toLowerCase();
    const named = robots.groups.filter(g => g.agents.some(a => a !== '*' && ua.includes(a)));
    if (named.length > 0) return named;
    return robots.groups.filter(g => g.agents.includes('*'));
}

/** @param pathWithQuery path plus query string, e.g. "/search?q=x". */
export function checkRobots(robots: ParsedRobots, pathWithQuery: string, agent = '*'): RobotsDecision {
    const groups = groupFor(robots, agent);
    let best: RobotsRule | null = null;
    for (const g of groups) {
        for (const r of g.rules) {
            if (!ruleMatches(r.path, pathWithQuery)) continue;
            if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) {
                best = r;
            }
        }
    }
    const crawlDelay = groups.find(g => g.crawlDelay != null)?.crawlDelay;
    if (!best) return { allowed: true, rule: '', crawlDelay };
    return { allowed: best.allow, rule: `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}`, crawlDelay };
}
