import { toMarkdown } from '../markdown';
import type { MetadataExtractOptions, MetadataExtractResult, HtmlMetadata, PageType, ExtractStats } from '../../../shared/types/metadata';

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

        // Stage 3: main content as markdown (services/markdown). Precision prunes chrome by density
        // (`fit`); recall keeps everything but what isn't rendered.
        const page = toMarkdown(document, {
            mode: favorPrecision ? 'fit' : 'markdown',
            mainContent: !favorRecall,
            includeLinks, includeTables, includeImages,
        });
        const markdown = page.markdown;
        const textChars = page.stats.keptChars;
        const usedFallback = page.fellBack;

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
            result.text = toMarkdown(document, { mode: 'text', mainContent: !favorRecall }).markdown;
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
