/** What AI Extract asks of a page (content script) and gets back: its view, and grounding of answers. */
import type { GradedSelector } from '../selectors/grade';
import type { StructuredData } from './structured';
import type { SchemaFieldType } from './schemaIntake';
import type { RevealReport } from '../types/reveal';

export interface PageView {
    url: string;
    title: string;
    /** The page as markdown, each leaf block ending in ` [bN]`, cut into chunks of at most `chunkChars`. */
    chunks: string[];
    /** More chunks than were asked for: the end of the page wasn't read. */
    truncated: boolean;
    structured: StructuredData;
    /** What was opened or read from hidden sections before the page was read. */
    revealed?: RevealReport;
    /** The pruned rendering (navigation and page furniture gone), same refs; only for long pages. */
    fit?: string;
    /** A listing page's list region: its blocks only, and how many items the container has. */
    region?: { markdown: string; items: number };
    /** Blocks read from a hidden section: ref → the section's name. */
    sections?: Record<string, string>;
}

export interface GroundRequest {
    /** The caller's id for the answer (`price`, `products.3.title`). */
    key: string;
    value: string;
    /** The block the model cited (`b12`), if any. */
    ref?: string;
    /** For a list item: its first block and the next item's first block; a value found between them is verified. */
    within?: [string, string | undefined];
    type: SchemaFieldType;
    /** Build a selector chain for the element (single fields that become Page Extractor elements). */
    compile?: boolean;
}

export type GroundStatus = 'verified' | 'relocated' | 'not_on_page' | 'empty';

export interface Grounded {
    key: string;
    status: GroundStatus;
    /** The block the value was found in (the evidence). */
    ref?: string;
    /** The value as the page has it: a link's URL, an image's source, else the element's text. */
    pageValue?: string;
    /** Page Extractor element type. */
    type: 'text' | 'link' | 'image';
    selectors: string[];
    matchCount: number;
    grade?: GradedSelector;
}

/** Where something the user picked on the page is on screen (Page assistant: asking about an image). */
export interface PickedRegion {
    /** In CSS pixels of the viewport, clipped to it. */
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
    /** What was picked, for the conversation ("Image: Red leather sofa", "Chart"). */
    label: string;
}
