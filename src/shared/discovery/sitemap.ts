/**
 * URL discovery helpers: sitemap parsing (urlset and sitemap index), URL path patterns for grouping
 * ("/product/*"), and include/exclude globs. Ideas from thenos crawler (sitemap, canonical, scope).
 */

export interface SitemapUrl {
    loc: string;
    lastmod?: string;
}

export interface ParsedSitemap {
    urls: SitemapUrl[];
    /** Child sitemaps when this is a sitemap index. */
    sitemaps: string[];
}

export function parseSitemapXml(xml: string): ParsedSitemap {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
        // Some servers send text sitemaps: one URL per line.
        const urls = xml.split(/\s+/).filter(l => /^https?:\/\//.test(l)).map(loc => ({ loc }));
        return { urls, sitemaps: [] };
    }
    const byLocal = (parent: Element | Document, name: string) =>
        Array.from(parent.getElementsByTagNameNS('*', name)).concat(
            parent.getElementsByTagNameNS('*', name).length === 0 ? Array.from(parent.getElementsByTagName(name)) : []);
    const text = (el: Element | undefined) => el?.textContent?.trim() || undefined;

    const sitemaps = byLocal(doc, 'sitemap').map(s => text(byLocal(s, 'loc')[0])).filter((x): x is string => !!x);
    const urls = byLocal(doc, 'url')
        .map(u => ({ loc: text(byLocal(u, 'loc')[0]) || '', lastmod: text(byLocal(u, 'lastmod')[0]) }))
        .filter(u => u.loc);
    return { urls, sitemaps };
}

const VARIABLE_SEGMENT = /^\d+$|^(?=[0-9a-f]*\d)[0-9a-f]{8,}$|^(?=[A-Z0-9]*\d)[A-Z0-9]{8,12}$|[-_].*\d|\d.*[-_]|^.{40,}$|\.(html?|php|aspx?)$/i;

/**
 * A grouping pattern for a URL's path: the last segment (and any id-like segment) becomes "*".
 * "/products/desk-lamp-123" → "/products/*"; "/blog/2024/05/post" → "/blog/*\/*\/*"; "/" → "/".
 */
export function urlPattern(url: string): string {
    let path: string;
    try { path = new URL(url).pathname; } catch { return url; }
    const segs = path.split('/').filter(Boolean);
    if (segs.length === 0) return '/';
    const out = segs.map((s, i) => (i === segs.length - 1 && segs.length > 1) || VARIABLE_SEGMENT.test(s) ? '*' : s);
    if (segs.length === 1) return VARIABLE_SEGMENT.test(segs[0]) ? '/*' : `/${segs[0]}`;
    return '/' + out.join('/');
}

export interface UrlGroup {
    pattern: string;
    urls: string[];
}

export function groupByPattern(urls: string[]): UrlGroup[] {
    const map = new Map<string, string[]>();
    for (const u of urls) {
        const p = urlPattern(u);
        const list = map.get(p);
        if (list) list.push(u); else map.set(p, [u]);
    }
    return Array.from(map.entries())
        .map(([pattern, list]) => ({ pattern, urls: list }))
        .sort((a, b) => b.urls.length - a.urls.length);
}

/** "*\/product/*" style glob over the full URL (or path when it starts with "/"). */
export function globToRegex(glob: string): RegExp {
    const escaped = glob.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(glob.trim().startsWith('/') ? `^${escaped}` : escaped, 'i');
}

export function matchesFilters(url: string, include: string, exclude: string): boolean {
    let target = url;
    const test = (globs: string) => globs.split(/[\n,]/).map(g => g.trim()).filter(Boolean).map(globToRegex);
    const inc = test(include);
    const exc = test(exclude);
    try {
        const u = new URL(url);
        target = url;
        const path = u.pathname + u.search;
        const hit = (re: RegExp) => re.test(re.source.startsWith('^') ? path : target);
        if (inc.length > 0 && !inc.some(hit)) return false;
        if (exc.some(hit)) return false;
        return true;
    } catch {
        return false;
    }
}
