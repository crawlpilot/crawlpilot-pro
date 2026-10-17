import type { ReconReport, Recommendation } from './types';

const DATA_TYPES = /product|offer|article|newsarticle|blogposting|jobposting|event|recipe|itemlist|localbusiness|organization|review|aggregaterating|breadcrumblist|faqpage|course|book|movie|place|person/i;

/** Turns a recon report into "how should I scrape this page?". Pure: tested on its own. */
export function recommend(r: ReconReport): Recommendation {
    const notes: string[] = [];
    const vendors = r.check.botManagers.filter(b => !['recaptcha', 'hcaptcha', 'turnstile', 'arkose'].includes(b.id));

    if (vendors.length > 0) {
        notes.push(`Bot protection: ${vendors.map(v => v.name).join(', ')}. Plain HTTP clients are often challenged; expect to need a real browser and modest request rates.`);
    }
    if (r.robots?.found && !r.robots.allowed) {
        notes.push(`robots.txt disallows this path (${r.robots.rule}).`);
    }
    if (r.robots?.crawlDelay) {
        notes.push(`robots.txt asks for a ${r.robots.crawlDelay}s crawl delay.`);
    }
    if (r.robots?.sitemaps.length) {
        notes.push(`${r.robots.sitemaps.length} sitemap${r.robots.sitemaps.length > 1 ? 's' : ''} listed in robots.txt: a fast way to collect URLs.`);
    }
    if (r.pagination.relNext) notes.push('Pagination uses rel="next" links: follow them directly.');
    else if (r.pagination.pageParam) notes.push(`Pagination looks URL-based (?${r.pagination.pageParam}=N): generate the page URLs instead of clicking.`);
    else if (r.pagination.loadMore) notes.push('A "load more" button: the extra items usually come from an API call (check the API Finder).');
    if (r.canonical && r.canonical !== r.url) notes.push('Canonical URL differs from this URL: dedupe on the canonical.');

    if (r.check.verdict === 'challenge' || r.check.verdict === 'blocked') {
        return {
            approach: 'blocked',
            headline: `This page is a ${r.check.verdict === 'challenge' ? 'bot check' : 'block page'}${r.check.reason ? ` (${r.check.reason})` : ''}. Solve or wait it out before scraping; automated clients will hit the same wall.`,
            notes,
        };
    }

    const structured = r.embedded.filter(e =>
        e.kind === 'next-data' || e.kind === 'nuxt-data' || e.kind === 'inline-state' ||
        (e.kind === 'json-ld' && (e.types ?? []).some(t => DATA_TYPES.test(t))));
    if (structured.length > 0) {
        const names = structured.slice(0, 2).map(e => e.label).join(' and ');
        const servedOk = r.rendering.servedStatus == null || r.rendering.servedStatus < 400;
        return {
            approach: servedOk ? 'http-json' : 'browser',
            headline: servedOk
                ? `The data is embedded as JSON (${names}). A plain HTTP request and a JSON parse is enough; no browser needed.`
                : `The data is embedded as JSON (${names}), but plain requests got HTTP ${r.rendering.servedStatus}. Read the JSON from a real browser session.`,
            notes,
        };
    }
    if (r.rendering.needsJs) {
        return {
            approach: 'browser',
            headline: 'The content is rendered by JavaScript. Use a browser (Playwright, Puppeteer) or call the API the page uses (API Finder).',
            notes,
        };
    }
    if (r.rendering.servedStatus != null && r.rendering.servedStatus >= 400) {
        return {
            approach: 'browser',
            headline: `A plain request for this page got HTTP ${r.rendering.servedStatus}, though it loads in the browser. Use a real browser session.`,
            notes,
        };
    }
    return {
        approach: 'http-html',
        headline: 'The content is in the HTML the server sends. Plain HTTP requests with CSS selectors will work.',
        notes,
    };
}
