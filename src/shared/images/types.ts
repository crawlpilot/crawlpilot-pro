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
    /** A larger original found for it (side panel only: set by the full-size search, checked by a probe). */
    full?: FullSize;
    /** Other images folded into this one (side panel only): the same picture at other sizes or URLs. */
    duplicates?: string[];
}

export interface FullSize {
    src: string;
    width: number;
    height: number;
    type: string;
    /** File size, when the server said. */
    bytes?: number;
    /** How it was found: `link` (the link around the image) or a CDN rule's name. */
    via: string;
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
