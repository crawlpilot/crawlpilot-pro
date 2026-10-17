/**
 * Collects a site's URLs from robots.txt → sitemaps (indexes, .gz) and from the links on the open
 * page. Runs in the side panel; needs host access for the site.
 */
import { parseRobots } from '../../shared/recon/robots';
import { parseSitemapXml } from '../../shared/discovery/sitemap';
import { cleanUrl } from '../../shared/transforms/parsers';

export interface DiscoveryProgress {
    sitemapsRead: number;
    urls: number;
    current?: string;
}

export interface DiscoveryResult {
    urls: string[];
    lastmod: Record<string, string>;
    sitemaps: string[];
    fromPage: number;
    errors: string[];
}

const FETCH_TIMEOUT_MS = 15000;

async function fetchText(url: string): Promise<string | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
        if (!res.ok) return null;
        const buf = new Uint8Array(await res.arrayBuffer());
        // Raw gzip (served as application/x-gzip rather than Content-Encoding): decompress here.
        if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
            const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
            return await new Response(stream).text();
        }
        return new TextDecoder().decode(buf);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function pageLinks(tabId: number, origin: string): Promise<string[]> {
    try {
        const [res] = await chrome.scripting.executeScript({
            target: { tabId },
            func: (o: string) => Array.from(document.querySelectorAll('a[href]'))
                .map(a => (a as HTMLAnchorElement).href)
                .filter(h => h.startsWith(o)),
            args: [origin],
        });
        return (res?.result as string[]) || [];
    } catch {
        return [];
    }
}

export async function discoverSiteUrls(
    pageUrl: string,
    tabId: number | undefined,
    opts: { maxSitemaps?: number; maxUrls?: number; signal?: AbortSignal; onProgress?: (p: DiscoveryProgress) => void } = {},
): Promise<DiscoveryResult> {
    const maxSitemaps = opts.maxSitemaps ?? 60;
    const maxUrls = opts.maxUrls ?? 50000;
    const origin = new URL(pageUrl).origin;
    const errors: string[] = [];
    const lastmod: Record<string, string> = {};
    const found = new Set<string>();

    const add = (raw: string, mod?: string) => {
        if (found.size >= maxUrls) return;
        const u = cleanUrl(raw);
        if (!u) return;
        found.add(u);
        if (mod) lastmod[u] = mod;
    };

    // 1. Sitemaps from robots.txt, else the usual locations.
    const queue: string[] = [];
    const robots = await fetchText(`${origin}/robots.txt`);
    if (robots && !/<html/i.test(robots)) queue.push(...parseRobots(robots).sitemaps);
    if (queue.length === 0) queue.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);

    const seen = new Set<string>();
    const sitemaps: string[] = [];
    while (queue.length > 0 && sitemaps.length < maxSitemaps && found.size < maxUrls) {
        if (opts.signal?.aborted) break;
        const batch = queue.splice(0, 4).filter(u => !seen.has(u));
        batch.forEach(u => seen.add(u));
        const texts = await Promise.all(batch.map(async u => ({ u, text: await fetchText(u) })));
        for (const { u, text } of texts) {
            if (!text) { errors.push(`Could not read ${u}`); continue; }
            sitemaps.push(u);
            const parsed = parseSitemapXml(text);
            parsed.sitemaps.forEach(s => { if (!seen.has(s)) queue.push(s); });
            parsed.urls.forEach(x => add(x.loc, x.lastmod));
            opts.onProgress?.({ sitemapsRead: sitemaps.length, urls: found.size, current: u });
        }
    }
    // Probing /sitemap_index.xml after /sitemap.xml worked is expected to 404: not worth reporting.
    const realErrors = sitemaps.length > 0 ? errors.filter(e => !e.endsWith('/sitemap_index.xml')) : errors;

    // 2. Links on the open page.
    let fromPage = 0;
    if (tabId !== undefined) {
        const links = await pageLinks(tabId, origin);
        const before = found.size;
        links.forEach(l => add(l));
        fromPage = found.size - before;
    }
    opts.onProgress?.({ sitemapsRead: sitemaps.length, urls: found.size });

    return { urls: Array.from(found), lastmod, sitemaps, fromPage, errors: realErrors };
}
