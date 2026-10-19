/** Metadata runs: each URL's title, author, dates, description and readable content as one row. */
import type { MetadataStart } from '../../shared/messages';
import type { HtmlMetadata, MetadataExtractOptions, MetadataExtractResult } from '../../shared/types/metadata';
import type { RunJob } from './JobRunner';
import type { Column } from '../../shared/types/database';

const COLUMNS: Column[] = ([
    { id: 'source_url', name: 'Source URL', type: 'url' },
    { id: 'title', name: 'Title', type: 'text' },
    { id: 'author', name: 'Author', type: 'text' },
    { id: 'description', name: 'Description', type: 'text' },
    { id: 'publishedDate', name: 'Published Date', type: 'text' },
    { id: 'pageType', name: 'Page Type', type: 'text' },
    { id: 'extractionQuality', name: 'Quality', type: 'text' },
    { id: 'keywords', name: 'Keywords', type: 'text' },
    { id: 'canonicalUrl', name: 'Canonical URL', type: 'url' },
    { id: 'siteName', name: 'Site Name', type: 'text' },
    { id: 'imageUrl', name: 'Image URL', type: 'url' },
    { id: 'markdown', name: 'Content (Markdown)', type: 'markdown' },
    { id: 'language', name: 'Language', type: 'text' },
    { id: 'wordCount', name: 'Word Count', type: 'text' },
    { id: 'readingTime', name: 'Reading Time', type: 'text' },
] as Column[]).map((c, order) => ({ ...c, order }));

function toRow(result: MetadataExtractResult, options: MetadataExtractOptions): Record<string, any> {
    const meta: HtmlMetadata = result.metadata ?? { keywords: [] };
    const text = result.text ?? result.markdown.replace(/[#*`_~\[\]!|>\\]/g, ' ').replace(/https?:\/\/\S+/g, '');
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    return {
        title: meta.title ?? '',
        author: meta.author ?? '',
        description: meta.description ?? '',
        publishedDate: meta.publishedDate ?? '',
        pageType: result.pageType,
        extractionQuality: result.extractionQuality.toFixed(2),
        keywords: (meta.keywords ?? []).join(', '),
        canonicalUrl: meta.canonicalUrl ?? '',
        siteName: meta.siteName ?? '',
        imageUrl: meta.imageUrl ?? '',
        markdown: result.markdown,
        language: result.language ?? meta.language ?? '',
        wordCount: words > 0 ? String(words) : '',
        readingTime: words > 0 ? `${Math.max(1, Math.ceil(words / 200))} min` : '',
        ...(options.outputText ? { text: result.text ?? '' } : {}),
    };
}

export function metadataJob(start: MetadataStart): RunJob {
    const options = start.options ?? {};
    const columns: Column[] = options.outputText ? [...COLUMNS, { id: 'text', name: 'Raw Text', type: 'text', order: COLUMNS.length }] : COLUMNS;

    return {
        kind: 'metadata',
        urls: start.urls,
        maxConcurrent: start.maxConcurrent,
        settings: { requestDelay: start.requestDelay ?? 1000, loadTimeout: start.loadTimeout ?? 30000 },
        name: start.customName,
        spec: { kind: 'metadata', options },
        tableType: 'metadata-extraction',
        columns: () => columns,

        async extract(tabId, url, ctx) {
            const response = await ctx.message(tabId, 'CMD_EXTRACT_METADATA', { url, options: { ...options, url } });
            if (!response.success) throw new Error(response.error || 'No result from content script');
            return { rows: [toRow(response.result, options)] };
        },
    };
}
