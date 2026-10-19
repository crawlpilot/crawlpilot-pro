/**
 * Every image on a page, for the Image Downloader. One `ImageCollector` per scan session: `scan(root)`
 * reads a subtree (the whole document the first time, then only what changed) and adds to what is
 * known, keyed by URL; `take()` returns what is new or better since the last call.
 *
 * Sources: `<img>` (the largest file: zoom attributes and the widest `srcset`, not the one shown),
 * `<picture>`, links to image files, CSS images (`background-image`, `image-set()`, masks, borders,
 * list markers, and `::before`/`::after` from the stylesheets), inline `<svg>` and SVG `<image>`,
 * video posters, `<canvas>`, `<input type=image>`, `<object>`/`<embed>`, `<noscript>` fallbacks, page
 * metadata (`og:image`, `twitter:image`, JSON-LD `image`) and icons. Open shadow roots and same-origin
 * iframes are read too.
 *
 * Hidden images (an inactive carousel slide, a closed menu) are kept and marked `hidden`.
 */
import type { FoundImage, ImageBatch, ImageOrigin } from '../../../shared/images/types';
import { guessType, looksLikeImageUrl } from '../../../shared/images/type';
import { imageCandidates } from './source';

/** Below this in both directions, a known-size image is a tracking pixel or a spacer. */
const TINY = 10;
/** Inline SVGs smaller than this are interface icons. */
const SVG_ICON = 24;
/** `data:` URLs shorter than this are placeholders (a 1×1 GIF is ~70 characters). */
const DATA_MIN = 100;
/** Elements per `::before`/`::after` rule. */
const PSEUDO_LIMIT = 200;
const CSS_IMAGE_PROPERTIES = ['background-image', 'mask-image', '-webkit-mask-image', 'border-image-source', 'list-style-image'];

interface Found {
    src: string;
    variants?: string[];
    origin: ImageOrigin;
    width?: number;
    height?: number;
    el?: Element;
    alt?: string;
}

/** URLs in a CSS value. An `image-set()` is one image: its densest entry, the rest variants. */
export function cssImages(value: string): { src: string; variants: string[] }[] {
    if (!value || value === 'none' || !value.includes('url(')) return [];
    const entries = Array.from(value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)(?:\s+(\d+(?:\.\d+)?)(?:x\b|dppx))?/g))
        .map(m => ({ url: m[2], density: m[3] ? parseFloat(m[3]) : 1 }))
        .filter(e => e.url);
    if (!entries.length) return [];
    if (!value.includes('image-set(')) return entries.map(e => ({ src: e.url, variants: [] }));
    const sorted = [...entries].sort((a, b) => b.density - a.density);
    return [{ src: sorted[0].url, variants: sorted.slice(1).map(e => e.url) }];
}

function isHidden(el: Element): boolean {
    const check = (el as HTMLElement).checkVisibility;
    if (typeof check === 'function') return !check.call(el, { opacityProperty: true, visibilityProperty: true });
    // jsdom: no checkVisibility, no layout.
    for (let e: Element | null = el; e; e = e.parentElement) {
        const style = e.ownerDocument.defaultView?.getComputedStyle(e);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return true;
    }
    return false;
}

function clean(text: string | null | undefined, max = 200): string | undefined {
    const t = (text ?? '').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, max) : undefined;
}

/** The nearest heading before `el`: in its ancestors' earlier content, up to 8 levels. */
function headingFor(el: Element): string | undefined {
    let node: Element | null = el;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
        const headings = Array.from(node.querySelectorAll('h1, h2, h3, h4'))
            .filter(h => h === node || (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
        const last = headings[headings.length - 1];
        if (last) return clean(last.textContent, 120);
    }
    return undefined;
}

function svgSize(svg: SVGSVGElement): { width: number; height: number } {
    const attr = (name: string) => parseFloat(svg.getAttribute(name) || '') || 0;
    let width = attr('width');
    let height = attr('height');
    const box = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    if ((!width || !height) && box.length === 4 && box[2] > 0 && box[3] > 0) {
        if (width) height = width * box[3] / box[2];
        else if (height) width = height * box[2] / box[3];
        else [width, height] = [box[2], box[3]];
    }
    const rect = svg.getBoundingClientRect();
    return { width: Math.round(rect.width || width), height: Math.round(rect.height || height) };
}

export class ImageCollector {
    private readonly found = new Map<string, FoundImage>();
    private added = new Set<string>();
    private updated = new Set<string>();
    private readonly canvases = new WeakSet<Element>();
    private readonly elements = new Map<string, WeakRef<Element>>();
    private order = 0;

    constructor(private readonly doc: Document = document) {}

    all(): FoundImage[] {
        return [...this.found.values()];
    }

    get size(): number {
        return this.found.size;
    }

    /** What is new or better since the last call. */
    take(): ImageBatch {
        const batch = {
            added: [...this.added].map(k => this.found.get(k)!),
            updated: [...this.updated].filter(k => !this.added.has(k)).map(k => this.found.get(k)!),
        };
        this.added = new Set();
        this.updated = new Set();
        return batch;
    }

    /** Reads `root` and everything under it (the document also gets its metadata, icons and stylesheets). `take()` returns what changed. */
    scan(root: Document | Element = this.doc) {
        if (root.nodeType === Node.DOCUMENT_NODE) {
            const doc = root as Document;
            this.metadata(doc);
            this.pseudoElements(doc);
            if (doc.body) this.walk(doc.body, true);
        } else {
            this.walk(root as Element, true);
        }
    }

    /** The element showing `src`, while it is still on the page. */
    elementFor(src: string): Element | null {
        const el = this.elements.get(src)?.deref();
        return el?.isConnected ? el : null;
    }

    /** Records a measured file size for a known image. */
    setSize(src: string, width: number, height: number) {
        const image = this.found.get(src);
        if (!image || (image.width === width && image.height === height)) return;
        image.width = width;
        image.height = height;
        this.updated.add(src);
    }

    private walk(root: Element | ShadowRoot, self: boolean) {
        if (self && root instanceof Element) this.element(root);
        for (const el of Array.from(root.querySelectorAll('*'))) {
            this.element(el);
            if (el.shadowRoot) this.walk(el.shadowRoot, false);
        }
    }

    private element(el: Element) {
        switch (el.tagName.toLowerCase()) {
            case 'img': this.img(el as HTMLImageElement); break;
            case 'a': this.link(el as HTMLAnchorElement); break;
            case 'video': {
                const poster = (el as HTMLVideoElement).poster;
                if (poster) this.add({ src: poster, origin: 'video', el });
                break;
            }
            case 'canvas': this.canvas(el as HTMLCanvasElement); break;
            case 'svg': this.svg(el as SVGSVGElement); break;
            case 'image': {
                const href = el.getAttribute('href') || el.getAttribute('xlink:href');
                if (href && el.closest('svg')) this.add({ src: href, origin: 'svg-image', el, width: parseFloat(el.getAttribute('width') || '') || 0, height: parseFloat(el.getAttribute('height') || '') || 0 });
                break;
            }
            case 'input':
                if ((el as HTMLInputElement).type === 'image' && (el as HTMLInputElement).src) this.add({ src: (el as HTMLInputElement).src, origin: 'input', el });
                break;
            case 'object':
            case 'embed': {
                const url = el.getAttribute(el.tagName === 'OBJECT' ? 'data' : 'src');
                if (url && ((el.getAttribute('type') || '').startsWith('image/') || looksLikeImageUrl(new URL(url, this.doc.baseURI).href))) this.add({ src: url, origin: 'object', el });
                break;
            }
            case 'noscript': this.noscript(el); break;
            case 'iframe': this.frame(el as HTMLIFrameElement); break;
        }
        this.css(el);
    }

    private img(img: HTMLImageElement) {
        const { src, variants, width } = imageCandidates(img);
        if (!src) return;
        const shownFile = img.complete && img.naturalWidth > 0 && img.currentSrc === src;
        const w = shownFile ? img.naturalWidth : width;
        let h = shownFile ? img.naturalHeight : 0;
        if (w && !h) {
            // A `srcset` width: the height from the element's aspect ratio.
            const ratio = img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth
                : (parseFloat(img.getAttribute('height') || '') / parseFloat(img.getAttribute('width') || '')) || 0;
            h = Math.round(w * ratio);
        }
        const link = img.closest('a[href]') as HTMLAnchorElement | null;
        const linked = link && looksLikeImageUrl(link.href) ? link.href : undefined;
        this.add({ src, variants, origin: 'img', el: img, width: w, height: h, alt: img.alt }, linked);
    }

    /** A link to an image file with no image inside: a file listing, a "download original" link. */
    private link(a: HTMLAnchorElement) {
        if (!a.href || !looksLikeImageUrl(a.href) || a.querySelector('img, picture, svg')) return;
        this.add({ src: a.href, origin: 'link', el: a, alt: clean(a.textContent) });
    }

    private canvas(canvas: HTMLCanvasElement) {
        if (this.canvases.has(canvas) || canvas.width < 20 || canvas.height < 20) return;
        this.canvases.add(canvas);
        try {
            const data = canvas.toDataURL('image/png');
            if (data.length > DATA_MIN * 2) this.add({ src: data, origin: 'canvas', el: canvas, width: canvas.width, height: canvas.height });
        } catch {
            // Tainted by a cross-origin image: unreadable.
        }
    }

    private svg(svg: SVGSVGElement) {
        if (svg.parentElement?.closest('svg')) return;
        const { width, height } = svgSize(svg);
        if (width < SVG_ICON && height < SVG_ICON) return;
        // A sprite reference renders nothing on its own.
        if (!svg.querySelector('path, rect, circle, ellipse, polygon, polyline, line, text, image, g > *')) return;
        const copy = svg.cloneNode(true) as SVGSVGElement;
        if (!copy.getAttribute('xmlns')) copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        if (!copy.getAttribute('width')) copy.setAttribute('width', String(width));
        if (!copy.getAttribute('height')) copy.setAttribute('height', String(height));
        const markup = new XMLSerializer().serializeToString(copy);
        this.add({ src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, origin: 'svg', el: svg, width, height, alt: clean(svg.querySelector('title')?.textContent || svg.getAttribute('aria-label')) });
    }

    /** `<noscript>` holds the real `<img>` on many lazy-loading sites. Parsed inertly: nothing loads. */
    private noscript(el: Element) {
        const text = el.textContent || '';
        if (!text.includes('<img')) return;
        const template = this.doc.createElement('template');
        template.innerHTML = text;
        for (const img of Array.from(template.content.querySelectorAll('img'))) {
            const { src, variants, width } = imageCandidates(img);
            if (src) this.add({ src, variants, origin: 'noscript', el, width, height: 0, alt: img.alt });
        }
    }

    /** Same-origin frames are read like the page; others can't be. */
    private frame(frame: HTMLIFrameElement) {
        let doc: Document | null = null;
        try { doc = frame.contentDocument; } catch { /* cross-origin */ }
        if (!doc?.body) return;
        this.metadata(doc);
        this.pseudoElements(doc);
        this.walk(doc.body, true);
    }

    private css(el: Element) {
        const style = el.ownerDocument.defaultView?.getComputedStyle(el);
        if (!style) return;
        for (const property of CSS_IMAGE_PROPERTIES) {
            for (const image of cssImages(style.getPropertyValue(property))) this.add({ ...image, origin: 'background', el });
        }
    }

    /** `::before`/`::after` images, read from the stylesheet rules (computed pseudo-styles are slow per element). */
    private pseudoElements(doc: Document) {
        const visit = (rules: CSSRuleList, base: string) => {
            for (const rule of Array.from(rules)) {
                const style = rule as CSSStyleRule;
                if (style.selectorText === undefined) {
                    if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules, base); // @media, @supports
                    continue;
                }
                if (!/::?(before|after)\b/.test(style.selectorText)) continue;
                const value = ['background-image', 'background', 'content', 'mask-image'].map(p => style.style.getPropertyValue(p)).join(' ');
                const images = cssImages(value);
                if (!images.length) continue;
                let targets: Element[] = [];
                try { targets = Array.from(doc.querySelectorAll(style.selectorText.replace(/::?(before|after)\b/g, '') || '*')).slice(0, PSEUDO_LIMIT); } catch { continue; }
                for (const el of targets) {
                    for (const image of images) {
                        this.add({ src: new URL(image.src, base).href, variants: image.variants.map(v => new URL(v, base).href), origin: 'pseudo', el });
                    }
                }
            }
        };
        for (const sheet of Array.from(doc.styleSheets)) {
            let rules: CSSRuleList;
            try { rules = sheet.cssRules; } catch { continue; } // cross-origin stylesheet
            visit(rules, sheet.href || doc.baseURI);
        }
    }

    private metadata(doc: Document) {
        const metas = doc.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"], meta[name="twitter:image"], meta[name="twitter:image:src"], meta[itemprop="image"]');
        for (const meta of Array.from(metas)) {
            const url = meta.getAttribute('content');
            if (url) this.add({ src: url, origin: 'meta' }, undefined, doc);
        }
        for (const link of Array.from(doc.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="image_src"]'))) {
            const href = link.getAttribute('href');
            const [w, h] = (link.getAttribute('sizes') || '').split('x').map(Number);
            if (href) this.add({ src: href, origin: link.getAttribute('rel') === 'image_src' ? 'meta' : 'icon', width: w || 0, height: h || 0 }, undefined, doc);
        }
        for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
            let data: unknown;
            try { data = JSON.parse(script.textContent || ''); } catch { continue; }
            for (const url of jsonLdImages(data)) this.add({ src: url, origin: 'meta' }, undefined, doc);
        }
    }

    private add(f: Found, linked?: string, doc: Document = f.el?.ownerDocument ?? this.doc) {
        const src = absolute(f.src, doc);
        if (!src || !usable(src)) return;
        if ((f.width ?? 0) > 0 && (f.height ?? 0) > 0 && f.width! < TINY && f.height! < TINY) return;
        const el = f.el;
        const rect = el && el.nodeType === Node.ELEMENT_NODE ? el.getBoundingClientRect() : null;
        const shown = rect && (rect.width || rect.height) ? { width: Math.round(rect.width), height: Math.round(rect.height) } : undefined;
        const variants = (f.variants ?? []).map(v => absolute(v, doc)).filter((v): v is string => !!v && v !== src && usable(v));
        if (el && (f.origin !== 'meta' && f.origin !== 'icon') && !this.elementFor(src)) this.elements.set(src, new WeakRef(el));
        const existing = this.found.get(src);
        if (!existing) {
            const figure = el?.closest('figure');
            this.found.set(src, {
                src, variants, linked, width: f.width || 0, height: f.height || 0, shown,
                type: guessType(src), origin: f.origin,
                alt: clean(f.alt), title: clean(el?.getAttribute('title')),
                caption: clean(figure?.querySelector('figcaption')?.textContent),
                heading: el ? headingFor(el) : undefined,
                hidden: el ? isHidden(el) : false,
                order: this.order++,
                top: rect ? Math.round(rect.top + (doc.defaultView?.scrollY ?? 0)) : undefined,
                pageUrl: this.doc.location?.href ?? '',
            });
            this.added.add(src);
            return;
        }
        let changed = false;
        for (const v of variants) if (!existing.variants.includes(v)) { existing.variants.push(v); changed = true; }
        if ((f.width ?? 0) * (f.height ?? 0) > existing.width * existing.height) { existing.width = f.width!; existing.height = f.height!; changed = true; }
        if (linked && !existing.linked) { existing.linked = linked; changed = true; }
        if (!existing.alt && f.alt) { existing.alt = clean(f.alt); changed = !!existing.alt || changed; }
        if (existing.hidden && el && !isHidden(el)) { existing.hidden = false; changed = true; }
        if (!existing.shown && shown) { existing.shown = shown; changed = true; }
        if (changed) this.updated.add(src);
    }
}

function absolute(url: string, doc: Document): string | null {
    const text = url.trim();
    if (text.startsWith('data:') || text.startsWith('blob:')) return text;
    try {
        const parsed = new URL(text, doc.baseURI);
        parsed.hash = '';
        return parsed.href;
    } catch {
        return null;
    }
}

function usable(url: string): boolean {
    if (url.startsWith('data:')) return url.length >= DATA_MIN && url.startsWith('data:image/');
    return url.startsWith('http:') || url.startsWith('https:') || url.startsWith('blob:');
}

/** Every `image` URL in JSON-LD (a string, an ImageObject, or a list of either), at any depth. */
function jsonLdImages(data: unknown, out: string[] = [], depth = 0): string[] {
    if (depth > 8 || !data || typeof data !== 'object') return out;
    if (Array.isArray(data)) { for (const d of data) jsonLdImages(d, out, depth + 1); return out; }
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (key === 'image' || key === 'thumbnailUrl' || (key === 'contentUrl' && (data as any)['@type'] === 'ImageObject')) {
            for (const v of Array.isArray(value) ? value : [value]) {
                if (typeof v === 'string') out.push(v);
                else if (v && typeof v === 'object' && typeof (v as any).url === 'string') out.push((v as any).url);
                else if (v && typeof v === 'object' && typeof (v as any).contentUrl === 'string') out.push((v as any).contentUrl);
            }
        } else if (typeof value === 'object') {
            jsonLdImages(value, out, depth + 1);
        }
    }
    return out;
}
