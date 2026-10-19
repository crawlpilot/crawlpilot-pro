/**
 * An image's real source. On a live page the browser has already chosen it (`currentSrc`); lazy
 * loaders hide it until the image nears the viewport, so the attributes are read in order (thenos
 * `clean/images.py`):
 *
 * 1. the largest `srcset` / `data-srcset` candidate (by `w` or `x` descriptor);
 * 2. a lazy-loading attribute (`data-src`, `data-lazy-src`, `data-original`, …);
 * 3. the largest `srcset` of the enclosing `<picture>`'s `<source>`s;
 * 4. `src`, when it isn't a placeholder (`data:`, a 1x1 GIF, `blank`/`spacer`/`loading`…).
 *
 * URLs are made absolute against the document.
 *
 * `imageCandidates` is the Image Downloader's version: the largest file the element can give
 * (zoom attributes, the widest `srcset` entry), not the one shown, plus every other URL it uses.
 */

const DESCRIPTOR = /^\d+(?:\.\d+)?[wx]$/;
const DATA_URI = /data:[^\s,]*,[^\s,]*(\s+\d+(?:\.\d+)?[wx])?/g;
const LAZY_ATTRIBUTES = [
    'data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-hi-res-src', 'data-hires',
    'data-zoom-image', 'data-large_image', 'data-large-image', 'data-full', 'data-full-src', 'data-image',
    'data-echo', 'data-orig-src', 'data-actualsrc',
];
const PLACEHOLDER = /(blank|spacer|placeholder|loading|lazy|transparent|pixel|1x1)[\w.-]*\.(gif|png|svg)/i;

/** Zoom and hi-res attributes: a larger file than the one shown. */
const LARGE_ATTRIBUTES = [
    'data-zoom-image', 'data-zoom-src', 'data-large_image', 'data-large-image', 'data-hi-res-src', 'data-hires',
    'data-full', 'data-full-src', 'data-orig-src', 'data-original-src',
];

export interface SrcsetEntry { url: string; size: number; unit: 'w' | 'x' }

export function parseSrcset(srcset: string): SrcsetEntry[] {
    const out: SrcsetEntry[] = [];
    for (const part of srcset.replace(DATA_URI, ' ').split(',')) {
        const tokens = part.trim().split(/\s+/);
        if (!tokens[0] || tokens[0].startsWith('data:')) continue;
        const last = tokens[tokens.length - 1];
        const described = tokens.length > 1 && DESCRIPTOR.test(last);
        out.push({ url: tokens[0], size: described ? parseFloat(last) : 1, unit: described && last.endsWith('w') ? 'w' : 'x' });
    }
    return out;
}

/** The biggest entry: by width when any entry gives one, else by density. */
function largest(entries: SrcsetEntry[]): SrcsetEntry | null {
    const widths = entries.filter(e => e.unit === 'w');
    const pool = widths.length ? widths : entries;
    return pool.reduce<SrcsetEntry | null>((best, e) => (!best || e.size > best.size ? e : best), null);
}

export function largestSrcset(srcset: string): string | null {
    return largest(parseSrcset(srcset))?.url ?? null;
}

function real(src: string | null | undefined): boolean {
    const text = (src ?? '').trim();
    return Boolean(text) && !text.startsWith('data:') && !PLACEHOLDER.test(text);
}

function absolute(url: string, doc: Document): string {
    try { return new URL(url, doc.baseURI).href; } catch { return url; }
}

export function imageSource(img: HTMLImageElement, live = true): string | null {
    const doc = img.ownerDocument;
    if (live && real(img.currentSrc)) return img.currentSrc;
    for (const attribute of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
        const value = img.getAttribute(attribute);
        const best = value ? largestSrcset(value) : null;
        if (best) return absolute(best, doc);
    }
    for (const attribute of LAZY_ATTRIBUTES) {
        const value = img.getAttribute(attribute);
        if (real(value)) return absolute(value!.trim(), doc);
    }
    const picture = img.closest('picture');
    if (picture) {
        for (const source of Array.from(picture.querySelectorAll('source'))) {
            const best = largestSrcset(source.getAttribute('srcset') || source.getAttribute('data-srcset') || '');
            if (best) return absolute(best, doc);
        }
    }
    const src = img.getAttribute('src');
    return real(src) ? absolute(src!.trim(), doc) : null;
}

export interface ImageCandidates {
    /** The largest file found. */
    src: string | null;
    /** Every other URL the element uses (the one shown, smaller `srcset` entries). */
    variants: string[];
    /** The width `srcset` gives the chosen file, when it gives one. */
    width: number;
}

export function imageCandidates(img: HTMLImageElement): ImageCandidates {
    const doc = img.ownerDocument;
    const entries: SrcsetEntry[] = [];
    for (const attribute of ['srcset', 'data-srcset', 'data-lazy-srcset']) entries.push(...parseSrcset(img.getAttribute(attribute) || ''));
    for (const source of Array.from(img.closest('picture')?.querySelectorAll('source') ?? [])) {
        entries.push(...parseSrcset(source.getAttribute('srcset') || source.getAttribute('data-srcset') || ''));
    }
    const urls: string[] = [];
    let width = 0;
    for (const attribute of LARGE_ATTRIBUTES) {
        const value = img.getAttribute(attribute);
        if (real(value)) urls.push(value!.trim());
    }
    const widest = largest(entries);
    if (widest) {
        urls.push(widest.url);
        if (urls[0] === widest.url) width = widest.unit === 'w' ? widest.size : 0;
    }
    if (real(img.currentSrc)) urls.push(img.currentSrc);
    for (const attribute of LAZY_ATTRIBUTES) {
        const value = img.getAttribute(attribute);
        if (real(value)) urls.push(value!.trim());
    }
    if (real(img.getAttribute('src'))) urls.push(img.getAttribute('src')!.trim());
    urls.push(...entries.map(e => e.url));
    const all = [...new Set(urls.map(u => absolute(u, doc)))];
    return { src: all[0] ?? null, variants: all.slice(1), width };
}
