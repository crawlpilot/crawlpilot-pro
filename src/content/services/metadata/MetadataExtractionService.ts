import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { MetadataExtractOptions, MetadataExtractResult, HtmlMetadata, PageType, ExtractStats } from '../../../shared/types/metadata';

// ─── Tag weight tables (article profile as default) ──────────────────────────

const TAG_WEIGHTS: Record<string, number> = {
    article: 8, main: 8,
    p: 3, blockquote: 3, pre: 3,
    h1: 2, h2: 2, h3: 2, h4: 1,
    li: 1, td: 1, th: 1,
    div: 0, span: 0, section: 0,
    nav: -6, footer: -6, header: -4, aside: -5,
    form: -10, button: -10, input: -10,
    script: -20, style: -20, noscript: -5,
};

const CLASS_PENALTIES = /\b(ad|ads|advert|advertisement|banner|sidebar|related|recommend|promo|popup|modal|cookie|newsletter|subscribe|social|share|comment|disqus|footer|header|nav|menu|breadcrumb|pagination)\b/i;
const CLASS_BOOSTS = /\b(article|content|story|post|entry|body|main|text|prose|markdown|blog)\b/i;

// ─── Stage 1: Metadata extraction ─────────────────────────────────────────────

function extractJsonLd(): Partial<HtmlMetadata> {
    const result: Partial<HtmlMetadata> = {};
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');

    for (const script of scripts) {
        try {
            const data = JSON.parse(script.textContent || '');
            const obj = Array.isArray(data) ? data[0] : data;
            if (!obj) continue;

            if (!result.title) result.title = obj.headline || obj.name;
            if (!result.description) result.description = obj.description;
            if (!result.publishedDate) result.publishedDate = obj.datePublished || obj.dateCreated;
            if (!result.siteName) result.siteName = obj.publisher?.name;
            if (!result.canonicalUrl) result.canonicalUrl = obj.url || obj.mainEntityOfPage?.['@id'];

            const authorField = obj.author;
            if (!result.author && authorField) {
                result.author = Array.isArray(authorField)
                    ? authorField.map((a: any) => a.name || a).join(', ')
                    : (authorField.name || authorField);
            }

            const imageField = obj.image;
            if (!result.imageUrl && imageField) {
                result.imageUrl = typeof imageField === 'string'
                    ? imageField
                    : (imageField.url || imageField['@id'] || (Array.isArray(imageField) ? imageField[0]?.url : undefined));
            }

            const keywords = obj.keywords;
            if (keywords && !result.keywords?.length) {
                result.keywords = typeof keywords === 'string'
                    ? keywords.split(',').map((k: string) => k.trim()).filter(Boolean)
                    : (Array.isArray(keywords) ? keywords : []);
            }
        } catch { /* malformed JSON-LD — skip */ }
    }

    return result;
}

function extractOpenGraph(): Partial<HtmlMetadata> {
    const result: Partial<HtmlMetadata> = {};
    const metas = document.querySelectorAll('meta[property^="og:"]');
    for (const meta of metas) {
        const prop = meta.getAttribute('property');
        const content = meta.getAttribute('content') || '';
        if (!content) continue;
        if (prop === 'og:title' && !result.title) result.title = content;
        if (prop === 'og:description' && !result.description) result.description = content;
        if (prop === 'og:site_name' && !result.siteName) result.siteName = content;
        if (prop === 'og:image' && !result.imageUrl) result.imageUrl = content;
        if (prop === 'og:url' && !result.canonicalUrl) result.canonicalUrl = content;
    }
    return result;
}

function extractTwitterCard(): Partial<HtmlMetadata> {
    const result: Partial<HtmlMetadata> = {};
    const metas = document.querySelectorAll('meta[name^="twitter:"]');
    for (const meta of metas) {
        const name = meta.getAttribute('name');
        const content = meta.getAttribute('content') || '';
        if (!content) continue;
        if (name === 'twitter:title' && !result.title) result.title = content;
        if (name === 'twitter:description' && !result.description) result.description = content;
        if (name === 'twitter:image' && !result.imageUrl) result.imageUrl = content;
        if (name === 'twitter:site' && !result.siteName) result.siteName = content;
    }
    return result;
}

function extractStandardMeta(): Partial<HtmlMetadata> {
    const result: Partial<HtmlMetadata> = {};
    const getMeta = (name: string) =>
        document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';

    const author = getMeta('author');
    if (author) result.author = author;

    const description = getMeta('description');
    if (description) result.description = description;

    const keywordsStr = getMeta('keywords');
    if (keywordsStr) {
        result.keywords = keywordsStr.split(',').map(k => k.trim()).filter(Boolean);
    }

    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (canonical) result.canonicalUrl = canonical;

    const lang = document.documentElement.getAttribute('lang') ||
        document.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content');
    if (lang) result.language = lang.split('-')[0];

    return result;
}

function mergeMetadata(...sources: Partial<HtmlMetadata>[]): HtmlMetadata {
    const merged: HtmlMetadata = { keywords: [] };
    for (const src of sources) {
        if (src.title && !merged.title) merged.title = src.title;
        if (src.description && !merged.description) merged.description = src.description;
        if (src.author && !merged.author) merged.author = src.author;
        if (src.publishedDate && !merged.publishedDate) merged.publishedDate = src.publishedDate;
        if (src.siteName && !merged.siteName) merged.siteName = src.siteName;
        if (src.imageUrl && !merged.imageUrl) merged.imageUrl = src.imageUrl;
        if (src.canonicalUrl && !merged.canonicalUrl) merged.canonicalUrl = src.canonicalUrl;
        if (src.language && !merged.language) merged.language = src.language;
        if (src.keywords?.length && !merged.keywords.length) merged.keywords = src.keywords;
    }
    // Final fallbacks
    if (!merged.title) merged.title = document.title || undefined;
    if (!merged.language) merged.language = document.documentElement.getAttribute('lang')?.split('-')[0] || undefined;
    return merged;
}

// ─── Stage 2: Page type classification ────────────────────────────────────────

function classifyPageType(url?: string): PageType {
    const path = url ? new URL(url, location.href).pathname.toLowerCase() : location.pathname.toLowerCase();

    // URL pattern matching
    if (/\/(forum|thread|discussion|topic|post|question|answer|community)/.test(path)) return 'forum';
    if (/\/(product|item|shop|store|buy|cart|checkout|p\/|dp\/)/.test(path)) return 'product';
    if (/\/(docs|documentation|guide|reference|api|wiki|manual|help|kb)/.test(path)) return 'documentation';
    if (/\/(blog|article|news|post|story|press|release|report)/.test(path)) return 'article';
    if (/\/(search|results|category|tag|list|catalog|collection|browse)/.test(path)) return 'listing';
    if (/^\/?$|\/home\/?$|\/index/.test(path)) return 'collection';

    // JSON-LD @type hint
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
        try {
            const data = JSON.parse(script.textContent || '');
            const obj = Array.isArray(data) ? data[0] : data;
            const type = (obj?.['@type'] || '').toLowerCase();
            if (/article|newsarticle|blogposting|reportage/.test(type)) return 'article';
            if (/product/.test(type)) return 'product';
            if (/discussionforum|forumposting/.test(type)) return 'forum';
            if (/technicaldocument|documentation/.test(type)) return 'documentation';
        } catch { /* skip */ }
    }

    // DOM class hints
    const bodyClass = (document.body.className + ' ' + document.body.id).toLowerCase();
    if (/\b(article|post|story|news|blog)\b/.test(bodyClass)) return 'article';
    if (/\b(product|shop|store|listing)\b/.test(bodyClass)) return 'product';
    if (/\b(forum|thread|discussion)\b/.test(bodyClass)) return 'forum';
    if (/\b(docs|documentation|wiki)\b/.test(bodyClass)) return 'documentation';

    return 'other';
}

// ─── Stage 3: Content scoring ─────────────────────────────────────────────────

interface ScoredElement {
    el: Element;
    score: number;
    textLength: number;
}

function scoreElement(el: Element): number {
    const tag = el.tagName.toLowerCase();
    let score = TAG_WEIGHTS[tag] ?? 0;

    const text = (el as HTMLElement).innerText || '';
    const textLen = text.trim().length;
    if (textLen === 0) return -Infinity;

    // Text density bonus
    score += Math.log1p(textLen) * 0.5;

    // Link density penalty
    const links = el.querySelectorAll('a');
    const linkText = Array.from(links).reduce((sum, a) => sum + ((a as HTMLElement).innerText?.length || 0), 0);
    if (textLen > 0 && linkText / textLen > 0.5) score *= 0.3;

    // Class-based adjustments
    const cls = ((el as HTMLElement).className || '') + ' ' + (el.id || '');
    if (CLASS_PENALTIES.test(cls)) score -= 8;
    if (CLASS_BOOSTS.test(cls)) score += 4;

    // aria-role hints
    const role = el.getAttribute('role') || '';
    if (role === 'main' || role === 'article') score += 6;
    if (role === 'navigation' || role === 'banner' || role === 'complementary') score -= 6;

    return score;
}

function findMainContent(favorPrecision = false, favorRecall = false): { el: Element | null; usedFallback: boolean } {
    const MIN_TEXT = favorPrecision ? 100 : 25;

    // Walk first-level block children of body scoring each subtree
    const candidates: ScoredElement[] = [];
    const walk = (root: Element, depth = 0) => {
        if (depth > 6) return;
        const children = Array.from(root.children);
        for (const child of children) {
            const tag = child.tagName.toLowerCase();
            if (['script', 'style', 'noscript', 'head', 'iframe'].includes(tag)) continue;
            const score = scoreElement(child);
            const textLen = ((child as HTMLElement).innerText || '').trim().length;
            if (textLen >= MIN_TEXT) {
                candidates.push({ el: child, score, textLength: textLen });
            }
            walk(child, depth + 1);
        }
    };
    walk(document.body);

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    // Pick top candidate if it passes minimum text threshold
    const best = candidates[0];
    if (best && best.textLength >= MIN_TEXT && best.score > 0) {
        return { el: best.el, usedFallback: false };
    }

    // Fallback chain (Stage 4)
    const fallbackSelectors = [
        'article',
        '[role="main"]',
        'main',
        '.article-body',
        '.post-content',
        '.entry-content',
        '.content',
        '#content',
        '.main-content',
        '#main',
    ];

    if (!favorPrecision || favorRecall) {
        for (const sel of fallbackSelectors) {
            const el = document.querySelector(sel);
            if (el && ((el as HTMLElement).innerText || '').trim().length >= MIN_TEXT) {
                return { el, usedFallback: true };
            }
        }

        // Last resort: collect all <p> tags
        const paragraphs = Array.from(document.querySelectorAll('p'));
        if (paragraphs.length > 0) {
            const div = document.createElement('div');
            paragraphs.forEach(p => div.appendChild(p.cloneNode(true)));
            return { el: div, usedFallback: true };
        }
    }

    return { el: null, usedFallback: true };
}

// ─── Stage 5: Markdown rendering ──────────────────────────────────────────────

function getTurndown(includeLinks: boolean, includeTables: boolean, includeImages: boolean): TurndownService {
    const td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        strongDelimiter: '**',
        emDelimiter: '_',
    });
    td.use(gfm);

    // Always strip noisy elements (svg excluded from the typed list — handled via addRule)
    td.remove(['script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside', 'form', 'button', 'input', 'select', 'textarea', 'iframe']);
    td.addRule('strip-svg', { filter: (node) => node.nodeName === 'SVG', replacement: () => '' });

    if (!includeLinks) {
        td.addRule('strip-links', {
            filter: 'a',
            replacement: (content) => content,
        });
    }

    if (!includeImages) {
        td.addRule('strip-images', {
            filter: 'img',
            replacement: () => '',
        });
    }

    if (!includeTables) {
        td.addRule('strip-tables', {
            filter: ['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'],
            replacement: (content) => content + '\n',
        });
    }

    return td;
}

function elementToMarkdown(el: Element, opts: Required<Pick<MetadataExtractOptions, 'includeLinks' | 'includeTables' | 'includeImages'>>): string {
    const td = getTurndown(opts.includeLinks, opts.includeTables, opts.includeImages);
    try {
        return td.turndown(el.outerHTML || '').trim();
    } catch {
        return (el as HTMLElement).innerText?.trim() || '';
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function extractMetadata(options: MetadataExtractOptions = {}): MetadataExtractResult {
    const {
        url,
        includeLinks = true,
        includeTables = true,
        includeImages = false,
        includeMetadata = true,
        outputText = false,
        favorPrecision = false,
        favorRecall = false,
    } = options;

    try {
        const elementCount = document.querySelectorAll('*').length;

        // Stage 1: Metadata
        const metadata = includeMetadata
            ? mergeMetadata(extractJsonLd(), extractOpenGraph(), extractTwitterCard(), extractStandardMeta())
            : { keywords: [] as string[] };

        // Stage 2: Page type
        const pageType = classifyPageType(url || location.href);

        // Stage 3+4: Content selection
        const { el: mainEl, usedFallback } = findMainContent(favorPrecision, favorRecall);

        // Stage 5: Markdown rendering
        let markdown = '';
        let textChars = 0;
        if (mainEl) {
            markdown = elementToMarkdown(mainEl, { includeLinks, includeTables, includeImages });
            textChars = markdown.replace(/[#*`\[\]()_~\->\s]/g, '').length;
        }

        // Extraction quality heuristic (0–1)
        let quality = 0;
        if (markdown.length > 500) quality = 0.9;
        else if (markdown.length > 200) quality = 0.7;
        else if (markdown.length > 50) quality = 0.5;
        else if (markdown.length > 0) quality = 0.3;
        if (usedFallback) quality *= 0.85;
        if (!metadata.title) quality *= 0.9;

        const stats: ExtractStats = {
            textChars,
            elementCount,
            usedFallback,
            pageType,
        };

        const result: MetadataExtractResult = {
            markdown,
            pageType,
            extractionQuality: Math.min(1, quality),
            language: metadata.language,
            metadata: includeMetadata ? metadata : undefined,
            stats,
        };

        if (outputText) {
            result.text = mainEl ? ((mainEl as HTMLElement).innerText || '').trim() : '';
        }

        return result;
    } catch (err: any) {
        return {
            markdown: '',
            pageType: 'other',
            extractionQuality: 0,
            errorReason: err?.message || 'Unknown extraction error',
        };
    }
}
