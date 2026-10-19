export interface ExtractionConfig {
    [key: string]: any;
}

export interface ElementDefinition {
    id: string;
    name: string;
    /** The element's chain, best first (CSS or XPath). */
    selectors: string[];
    action: 'extract' | 'click';
    type?: string;
    [key: string]: any;
}

export interface ExtractionResult {
    success: boolean;
    error?: string;
    data?: any;
    columns?: any[];
}

export interface ProcessedElementResult {
    elementId: string;
    elementName: string;
    /** Found by a loosened selector (`ElementProcessor.heal`). */
    healed?: boolean;
    /** Read from the page's data, not the DOM (`dataBinding.ts`). */
    fromData?: boolean;
    /** For a click step: how it went (`ElementProcessor.click`). */
    step?: 'clicked' | 'already-open' | 'opened' | 'no-effect';
    success: boolean;
    error?: string | null;
    data?: any;
    columns?: any[];
}
