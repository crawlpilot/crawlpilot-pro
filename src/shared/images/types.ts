/** What the Image Downloader finds on a page, as the content script reports it to the side panel. */

/** Where on the page an image came from. */
export type ImageOrigin =
    | 'img' | 'link' | 'background' | 'pseudo' | 'svg' | 'svg-image' | 'video'
    | 'canvas' | 'input' | 'object' | 'noscript' | 'meta' | 'icon';

export interface FoundImage {
    /** The largest file found for it (absolute URL; `data:` for inline SVG and canvas). */
    src: string;
    /** Other URLs of the same image (the size shown, smaller `srcset` entries). */
    variants: string[];
    /** The href of a link around it that points to an image: usually the full-size original. */
    linked?: string;
    /** The file's size in pixels; 0 when not known yet (measured after the scan). */
    width: number;
    height: number;
    /** The size it is shown at on the page. */
    shown?: { width: number; height: number };
    /** MIME type, guessed from the URL until the file is fetched; '' when unknown. */
    type: string;
    origin: ImageOrigin;
    alt?: string;
    title?: string;
    caption?: string;
    /** The nearest heading before it. */
    heading?: string;
    /** Not displayed: an inactive carousel slide, a closed menu, `display: none`. */
    hidden: boolean;
    /** Order of discovery (page order for a single pass). */
    order: number;
    /** Distance from the top of the page, in CSS pixels. */
    top?: number;
    pageUrl: string;
}

/** Images new to the scan, and known images with better information (a size, a link). */
export interface ImageBatch {
    added: FoundImage[];
    updated: FoundImage[];
}

export interface ImageScanProgress {
    phase: 'scrolling' | 'measuring' | 'complete' | 'cancelled';
    /** 0–100, how far down the page the scroll is. */
    percent: number;
    found: number;
}
