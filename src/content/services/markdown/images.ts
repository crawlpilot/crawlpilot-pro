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
 */

const DESCRIPTOR = /^\d+(?:\.\d+)?[wx]$/;
const DATA_URI = /data:[^\s,]*,[^\s,]*(\s+\d+(?:\.\d+)?[wx])?/g;
const LAZY_ATTRIBUTES = [
    'data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-hi-res-src', 'data-hires',
    'data-zoom-image', 'data-large_image', 'data-large-image', 'data-full', 'data-full-src', 'data-image',
    'data-echo', 'data-orig-src', 'data-actualsrc',
];
const PLACEHOLDER = /(blank|spacer|placeholder|loading|lazy|transparent|pixel|1x1)[\w.-]*\.(gif|png|svg)/i;

export function largestSrcset(srcset: string): string | null {
    let best: [number, string] | null = null;
    for (const part of srcset.replace(DATA_URI, ' ').split(',')) {
        const tokens = part.trim().split(/\s+/);
        if (!tokens[0] || tokens[0].startsWith('data:')) continue;
        const last = tokens[tokens.length - 1];
        const size = tokens.length > 1 && DESCRIPTOR.test(last) ? parseFloat(last) : 1;
        if (!best || size > best[0]) best = [size, tokens[0]];
    }
    return best ? best[1] : null;
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
