export type PageType =
    | 'article'
    | 'forum'
    | 'product'
    | 'listing'
    | 'collection'
    | 'documentation'
    | 'service'
    | 'other';

export interface HtmlMetadata {
    title?: string;
    description?: string;
    author?: string;
    publishedDate?: string;
    siteName?: string;
    imageUrl?: string;
    canonicalUrl?: string;
    language?: string;
    keywords: string[];
}

export interface ExtractStats {
    textChars: number;
    elementCount: number;
    usedFallback: boolean;
    pageType: string;
}

export interface MetadataExtractResult {
    markdown: string;
    text?: string;
    pageType: PageType;
    extractionQuality: number;
    language?: string;
    metadata?: HtmlMetadata;
    stats?: ExtractStats;
    errorReason?: string;
}

export interface MetadataExtractOptions {
    url?: string;
    includeLinks?: boolean;
    includeTables?: boolean;
    includeImages?: boolean;
    includeMetadata?: boolean;
    outputText?: boolean;
    favorPrecision?: boolean;
    favorRecall?: boolean;
}
