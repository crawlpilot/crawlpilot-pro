import type { PageClassification } from '../verdict/classifyPage';

export type EmbeddedKind =
    | 'json-ld' | 'next-data' | 'nuxt-data' | 'json-script' | 'inline-state' | 'microdata' | 'opengraph';

export interface EmbeddedData {
    kind: EmbeddedKind;
    /** Human label, e.g. "JSON-LD Product" or "__NEXT_DATA__". */
    label: string;
    /** Characters of source. */
    size: number;
    /** schema.org @type values (JSON-LD, microdata). */
    types?: string[];
    /** Pretty JSON when it parsed, truncated. */
    json?: string;
}

export interface RobotsInfo {
    found: boolean;
    status: number;
    allowed: boolean;
    rule: string;
    crawlDelay?: number;
    sitemaps: string[];
}

export interface RenderingInfo {
    /** Frameworks and platforms seen in the markup. */
    frameworks: string[];
    /** An empty app root (#root, #__next …) in the served HTML. */
    spaShell: boolean;
    liveTextLength: number;
    /** Visible text in the HTML the server sent, before JavaScript ran (undefined when not fetched). */
    servedTextLength?: number;
    servedStatus?: number;
    /** True when most of the visible text only exists after JavaScript ran. */
    needsJs?: boolean;
}

export interface PaginationHint {
    relNext?: string;
    pageParam?: string;
    loadMore: boolean;
    nextButton: boolean;
}

export interface ReconReport {
    url: string;
    title: string;
    check: PageClassification;
    rendering: RenderingInfo;
    embedded: EmbeddedData[];
    canonical?: string;
    hreflangCount: number;
    robotsMeta?: string;
    feeds: string[];
    robots?: RobotsInfo;
    pagination: PaginationHint;
}

export interface Recommendation {
    /** One plain sentence. */
    headline: string;
    approach: 'http-json' | 'http-html' | 'browser' | 'blocked';
    notes: string[];
}
