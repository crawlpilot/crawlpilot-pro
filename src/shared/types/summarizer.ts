export const SUMMARIZER_EXTRACTION_RESULT = 'SUMMARIZER_EXTRACTION_RESULT';

export interface ExtractedContent {
    title: string;
    byline: string | null;
    excerpt: string | null;
    siteName: string | null;
    text: string;
    source: 'readability' | 'heuristic' | 'body';
    truncated: boolean;
}

export interface ExtractionResultMessage {
    type: typeof SUMMARIZER_EXTRACTION_RESULT;
    payload: ExtractedContent;
}

export type SummaryType = 'key-points' | 'tldr' | 'teaser' | 'headline';
export type SummaryLength = 'short' | 'medium' | 'long';
