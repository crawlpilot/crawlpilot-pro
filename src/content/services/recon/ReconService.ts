/**
 * Page Recon: reads the current page and answers "how should I scrape this?" — where the data lives
 * (served HTML, embedded JSON, or only after JavaScript), what protects it, what robots.txt says, and
 * how it paginates. Runs in the content script; makes at most two same-origin GETs (the page itself,
 * to compare served vs rendered, and /robots.txt).
 */
import { classifyPage, collectPageSignals } from '../../../shared/verdict/classifyPage';
import { parseRobots, checkRobots } from '../../../shared/recon/robots';
import type { EmbeddedData, ReconReport, RenderingInfo, RobotsInfo, PaginationHint } from '../../../shared/recon/types';

const MAX_JSON_CHARS = 200_000;
const FETCH_TIMEOUT_MS = 8000;

function pretty(value: unknown): string {
    const s = JSON.stringify(value, null, 2);
    return s.length > MAX_JSON_CHARS ? s.slice(0, MAX_JSON_CHARS) + '\n… (truncated)' : s;
}

function tryParse(text: string): unknown | undefined {
    try { return JSON.parse(text); } catch { return undefined; }
}

function collectTypes(node: any, out: Set<string>) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => collectTypes(n, out)); return; }
    const t = node['@type'];
    if (typeof t === 'string') out.add(t);
    else if (Array.isArray(t)) t.forEach(x => typeof x === 'string' && out.add(x));
    if (node['@graph']) collectTypes(node['@graph'], out);
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { credentials: 'include', cache: 'no-store', signal: ctrl.signal, redirect: 'follow' });
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function visibleTextLengthOfHtml(html: string): number {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript, template, svg').forEach(n => n.remove());
    return (doc.body?.textContent || '').replace(/\s+/g, ' ').trim().length;
}

const SPA_SHELL = /<div[^>]+id=["'](root|app|__next|__nuxt|svelte|___gatsby)["'][^>]*>\s*<\/div>/i;

export function detectFrameworks(doc: Document = document): string[] {
    const f: string[] = [];
    const has = (sel: string) => !!doc.querySelector(sel);
    const html = doc.documentElement.outerHTML.slice(0, 400_000);
    if (has('script#__NEXT_DATA__') || has('#__next') || html.includes('/_next/static/')) f.push('Next.js');
    if (has('#__nuxt') || has('script#__NUXT_DATA__') || html.includes('window.__NUXT__')) f.push('Nuxt');
    if (has('#___gatsby')) f.push('Gatsby');
    if (html.includes('__remixContext')) f.push('Remix');
    if (has('astro-island')) f.push('Astro');
    if (has('[data-sveltekit-preload-data]') || html.includes('__sveltekit')) f.push('SvelteKit');
    if (has('[ng-version]')) f.push('Angular');
    if (has('[data-v-app]') || has('[data-server-rendered]')) f.push('Vue');
    if (has('[data-reactroot]') || f.some(x => ['Next.js', 'Gatsby', 'Remix'].includes(x))) f.push('React');
    if (html.includes('cdn.shopify.com') || html.includes('Shopify.theme')) f.push('Shopify');
    if (html.includes('/wp-content/') || html.includes('/wp-includes/')) f.push('WordPress');
    if (html.includes('Magento_') || html.includes('mage-init')) f.push('Magento');
    if (html.includes('woocommerce')) f.push('WooCommerce');
    const generator = doc.querySelector('meta[name="generator"]')?.getAttribute('content');
    if (generator && !f.some(x => generator.toLowerCase().includes(x.toLowerCase()))) f.push(generator.split(/[\s;]/)[0]);
    return Array.from(new Set(f));
}

export function collectEmbedded(doc: Document = document): EmbeddedData[] {
    const out: EmbeddedData[] = [];

    doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        const text = s.textContent || '';
        const parsed = tryParse(text.trim());
        const types = new Set<string>();
        collectTypes(parsed, types);
        const typeList = Array.from(types);
        out.push({
            kind: 'json-ld',
            label: `JSON-LD ${typeList.slice(0, 3).join(', ') || '(untyped)'}`,
            size: text.length,
            types: typeList,
            json: parsed !== undefined ? pretty(parsed) : undefined,
        });
    });

    doc.querySelectorAll('script[type="application/json"], script[type="application/vnd.json"]').forEach(s => {
        const text = s.textContent || '';
        if (text.length < 200) return; // config blobs and flags, not data
        const id = s.id || s.getAttribute('data-target') || '';
        const parsed = tryParse(text.trim());
        const kind = id === '__NEXT_DATA__' ? 'next-data' : id === '__NUXT_DATA__' ? 'nuxt-data' : 'json-script';
        out.push({
            kind,
            label: id ? id : 'JSON script',
            size: text.length,
            json: parsed !== undefined ? pretty(parsed) : undefined,
        });
    });

    // Inline state assigned to window (Redux, Apollo, Nuxt 2, Remix…): report size; parse when it is plain JSON.
    const STATE = /(window\.)?(__INITIAL_STATE__|__PRELOADED_STATE__|__APOLLO_STATE__|__NUXT__|__remixContext|__INITIAL_DATA__|__STATE__|__DATA__)\s*=\s*/;
    doc.querySelectorAll('script:not([src]):not([type]), script[type="text/javascript"]:not([src])').forEach(s => {
        const text = s.textContent || '';
        const m = STATE.exec(text);
        if (!m) return;
        const start = m.index + m[0].length;
        const body = text.slice(start).replace(/;\s*$/, '').trim();
        const parsed = body.startsWith('{') || body.startsWith('[') ? tryParse(body.replace(/;[\s\S]*$/, '')) : undefined;
        out.push({
            kind: 'inline-state',
            label: m[2],
            size: body.length,
            json: parsed !== undefined ? pretty(parsed) : undefined,
        });
    });

    const microdata = Array.from(doc.querySelectorAll('[itemscope][itemtype]'))
        .filter(el => !el.parentElement?.closest('[itemscope]'));
    if (microdata.length > 0) {
        const types = Array.from(new Set(microdata.map(el => (el.getAttribute('itemtype') || '').split('/').pop() || '').filter(Boolean)));
        out.push({ kind: 'microdata', label: `Microdata ${types.slice(0, 3).join(', ')}`, size: microdata.length, types });
    }

    const og: Record<string, string> = {};
    doc.querySelectorAll('meta[property^="og:"], meta[property^="product:"]').forEach(m => {
        const p = m.getAttribute('property');
        const c = m.getAttribute('content');
        if (p && c) og[p] = c;
    });
    if (Object.keys(og).length > 0) {
        out.push({ kind: 'opengraph', label: `OpenGraph (${Object.keys(og).length} tags)`, size: Object.keys(og).length, json: pretty(og) });
    }
    return out;
}

export function detectPagination(doc: Document = document, url = location.href): PaginationHint {
    const relNext = (doc.querySelector('link[rel="next"], a[rel="next"]') as HTMLLinkElement | HTMLAnchorElement | null)?.href || undefined;
    const PARAM = /[?&](page|p|pg|pagenum|page_number|offset|start|from|skip)=(\d+)/i;
    let pageParam = PARAM.exec(url)?.[1];
    if (!pageParam) {
        for (const a of Array.from(doc.querySelectorAll('a[href]')).slice(0, 2000)) {
            const m = PARAM.exec((a as HTMLAnchorElement).href);
            if (m) { pageParam = m[1]; break; }
        }
    }
    const clickables = Array.from(doc.querySelectorAll('button, a, [role="button"]')).slice(0, 3000);
    const textOf = (el: Element) => ((el as HTMLElement).innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
    const loadMore = clickables.some(el => /^(load|show|view|see) more\b/i.test(textOf(el)));
    const nextButton = clickables.some(el => /^(next( page)?|›|»|→|>)$/i.test(textOf(el)) || /next/i.test(el.getAttribute('aria-label') || ''));
    return { relNext, pageParam, loadMore, nextButton };
}

async function readRobots(): Promise<RobotsInfo> {
    const res = await fetchWithTimeout(`${location.origin}/robots.txt`);
    if (!res || !res.ok) return { found: false, status: res?.status ?? 0, allowed: true, rule: '', sitemaps: [] };
    const type = res.headers.get('content-type') || '';
    const text = await res.text();
    if (type.includes('html') && /<html/i.test(text)) {
        // Some sites answer every path with their app shell.
        return { found: false, status: res.status, allowed: true, rule: '', sitemaps: [] };
    }
    const parsed = parseRobots(text);
    const decision = checkRobots(parsed, location.pathname + location.search);
    return { found: true, status: res.status, allowed: decision.allowed, rule: decision.rule, crawlDelay: decision.crawlDelay, sitemaps: parsed.sitemaps };
}

async function readRendering(liveTextLength: number): Promise<RenderingInfo> {
    const frameworks = detectFrameworks();
    const info: RenderingInfo = { frameworks, spaShell: false, liveTextLength };
    const res = await fetchWithTimeout(location.href);
    if (!res) return info;
    info.servedStatus = res.status;
    const html = await res.text();
    info.spaShell = SPA_SHELL.test(html);
    info.servedTextLength = visibleTextLengthOfHtml(html);
    info.needsJs = liveTextLength > 500 && info.servedTextLength < liveTextLength * 0.3;
    return info;
}

export async function runRecon(): Promise<ReconReport> {
    const signals = collectPageSignals();
    const check = classifyPage(signals, location.href);
    const [rendering, robots] = await Promise.all([readRendering(signals.textLength), readRobots()]);
    return {
        url: location.href,
        title: document.title,
        check,
        rendering,
        embedded: collectEmbedded(),
        canonical: (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href || undefined,
        hreflangCount: document.querySelectorAll('link[rel="alternate"][hreflang]').length,
        robotsMeta: document.querySelector('meta[name="robots"]')?.getAttribute('content') || undefined,
        feeds: Array.from(document.querySelectorAll('link[type="application/rss+xml"], link[type="application/atom+xml"]'))
            .map(l => (l as HTMLLinkElement).href).filter(Boolean),
        robots,
        pagination: detectPagination(),
    };
}
