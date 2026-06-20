export interface ImageMeta {
    src: string;
    naturalWidth: number;
    naturalHeight: number;
    alt?: string;
    type?: string;
    sizeBytes?: number;
    element: 'img' | 'video' | 'bg' | 'svg' | 'source' | 'canvas';
    pageUrl: string;
    isVisible?: boolean;
}

export class ImageScanner {
    private static images: Map<string, ImageMeta> = new Map();
    private static pageUrl: string = '';

    /** Full scan — clears previous results, returns all images found. */
    public static scan(): ImageMeta[] {
        this.images.clear();
        this.pageUrl = window.location.href;
        this.scanElement(document.body);
        return Array.from(this.images.values());
    }

    /** Incremental scan — does NOT clear. Returns only newly found images (delta). */
    public static scanMerge(): ImageMeta[] {
        this.pageUrl = window.location.href;
        const beforeCount = this.images.size;
        this.scanElement(document.body);
        // Return only the new entries
        const all = Array.from(this.images.values());
        return all.slice(beforeCount);
    }

    /** Returns all accumulated images across all scanMerge calls. */
    public static getAll(): ImageMeta[] {
        return Array.from(this.images.values());
    }

    /** Clears the accumulator. */
    public static reset(): void {
        this.images.clear();
    }

    private static scanElement(root: Element | ShadowRoot) {
        if (!root) return;

        const children = root.querySelectorAll('*');
        children.forEach(el => {
            this.processElement(el);

            // Recurse into Shadow DOM if present and open
            if (el.shadowRoot) {
                this.scanElement(el.shadowRoot);
            }
        });
    }

    private static processElement(el: Element) {
        const tagName = el.tagName.toLowerCase();

        // 1. <img> tags
        if (tagName === 'img') {
            this.processImg(el as HTMLImageElement);
        }

        // 2. <picture> -> <source> tags
        if (tagName === 'source') {
            this.processSource(el as HTMLSourceElement);
        }

        // 3. <video> posters
        if (tagName === 'video') {
            const video = el as HTMLVideoElement;
            if (this.isValidUrl(video.poster)) {
                this.addImage(video.poster, {
                    src: video.poster,
                    naturalWidth: video.videoWidth || 0,
                    naturalHeight: video.videoHeight || 0,
                    alt: 'Video Poster',
                    element: 'video',
                    pageUrl: this.pageUrl
                });
            }
        }

        // 4. <canvas> — extract rendered content as data URL
        if (tagName === 'canvas') {
            this.processCanvas(el as HTMLCanvasElement);
        }

        // 5. Background Images (computed style + inline style attribute)
        this.scanBackgroundImage(el);
    }

    private static processImg(img: HTMLImageElement) {
        // Handle lazy-loaded images that haven't loaded yet
        const lazySrc = img.dataset.src || img.dataset.lazySrc || img.getAttribute('data-original');
        const src = this.getBestSrc(img) || lazySrc;

        if (!this.isValidUrl(src)) return;

        let width = img.naturalWidth;
        let height = img.naturalHeight;

        // Fallback: Check attributes
        if (width === 0 || height === 0) {
            width = parseInt(img.getAttribute('width') || '0', 10);
            height = parseInt(img.getAttribute('height') || '0', 10);
        }

        // Fallback: Check rendered size
        if (width === 0 || height === 0) {
            const rect = img.getBoundingClientRect();
            width = Math.round(rect.width);
            height = Math.round(rect.height);
        }

        // If still 0x0, it's likely invisible/stale — skip it
        if (width === 0 && height === 0) return;

        this.addImage(src!, {
            src: src!,
            naturalWidth: width,
            naturalHeight: height,
            alt: img.alt,
            element: 'img',
            pageUrl: this.pageUrl,
            isVisible: this.isElementVisible(img)
        });
    }

    private static processSource(source: HTMLSourceElement) {
        const src = this.getSrcSetMax(source.srcset) || source.src;
        if (!this.isValidUrl(src)) return;

        const parent = source.closest('picture');
        const siblingImg = parent?.querySelector('img');

        let width = siblingImg?.naturalWidth || 0;
        let height = siblingImg?.naturalHeight || 0;

        if (width === 0 && siblingImg) {
            width = parseInt(siblingImg.getAttribute('width') || '0', 10);
            height = parseInt(siblingImg.getAttribute('height') || '0', 10);
        }

        if (width === 0 && siblingImg) {
            const rect = siblingImg.getBoundingClientRect();
            width = Math.round(rect.width);
            height = Math.round(rect.height);
        }

        if (width === 0 && height === 0) return;

        this.addImage(src!, {
            src: src!,
            naturalWidth: width,
            naturalHeight: height,
            alt: siblingImg?.alt || 'Source Image',
            element: 'source',
            pageUrl: this.pageUrl,
            isVisible: siblingImg ? this.isElementVisible(siblingImg) : undefined
        });
    }

    private static processCanvas(canvas: HTMLCanvasElement) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) return;
        try {
            const dataUrl = canvas.toDataURL('image/png');
            if (dataUrl && dataUrl.length > 100) {
                this.addImage(dataUrl, {
                    src: dataUrl,
                    naturalWidth: canvas.width,
                    naturalHeight: canvas.height,
                    alt: 'Canvas Image',
                    element: 'canvas',
                    pageUrl: this.pageUrl,
                    isVisible: true
                });
            }
        } catch {
            // Canvas is tainted (cross-origin) — skip it
        }
    }

    private static scanBackgroundImage(el: Element) {
        // 1. Check inline style attribute (catches virtualized/hidden elements)
        const inlineStyle = el.getAttribute('style');
        if (inlineStyle && inlineStyle.includes('url(')) {
            const matches = inlineStyle.matchAll(/url\((['"]?)(.*?)\1\)/g);
            for (const match of matches) {
                const url = match[2];
                if (this.isValidUrl(url)) {
                    const rect = el.getBoundingClientRect();
                    this.addImage(url, {
                        src: url,
                        naturalWidth: Math.round(rect.width) || 0,
                        naturalHeight: Math.round(rect.height) || 0,
                        alt: 'Background Image',
                        element: 'bg',
                        pageUrl: this.pageUrl,
                        isVisible: rect.width > 0 && rect.height > 0
                    });
                }
            }
            return; // Already handled — skip computed style to avoid duplicates
        }

        // 2. Computed style fallback
        const style = window.getComputedStyle(el);
        const bgImage = style.backgroundImage;

        if (bgImage && bgImage !== 'none') {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            const matches = bgImage.matchAll(/url\((['"]?)(.*?)\1\)/g);
            for (const match of matches) {
                const url = match[2];
                if (this.isValidUrl(url)) {
                    this.addImage(url, {
                        src: url,
                        naturalWidth: Math.round(rect.width),
                        naturalHeight: Math.round(rect.height),
                        element: 'bg',
                        pageUrl: this.pageUrl,
                        isVisible: true
                    });
                }
            }
        }
    }

    private static isElementVisible(el: Element): boolean {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        return true;
    }

    private static getBestSrc(img: HTMLImageElement): string | null {
        if (img.currentSrc) return img.currentSrc;
        if (img.srcset) return this.getSrcSetMax(img.srcset) || img.src || null;
        return img.src || null;
    }

    private static getSrcSetMax(srcset: string): string | null {
        if (!srcset) return null;
        try {
            const sources = srcset.split(',').map(s => {
                const parts = s.trim().split(/\s+/);
                const url = parts[0];
                const cleanUrl = url.replace(/['"]/g, '');

                let width = 0;
                if (parts.length > 1) {
                    const desc = parts[1];
                    if (desc.endsWith('w')) width = parseInt(desc.slice(0, -1), 10);
                    if (desc.endsWith('x')) width = parseFloat(desc.slice(0, -1)) * 1000;
                }
                return { url: cleanUrl, width };
            });

            if (sources.length === 0) return null;
            sources.sort((a, b) => b.width - a.width);
            return sources[0]?.url || null;
        } catch {
            return null;
        }
    }

    private static isValidUrl(url: string | undefined | null): boolean {
        if (!url) return false;
        if (url.length < 5) return false;
        // Allow blob: URLs (used by some SPAs)
        if (url.startsWith('blob:')) return true;
        // Skip tiny data URIs (tracking pixels) but allow large ones (canvas exports)
        if (url.startsWith('data:')) return url.length > 200;
        return true;
    }

    private static addImage(src: string, meta: ImageMeta) {
        // Filter out tiny tracking pixels if dimensions are known
        if (meta.naturalWidth > 0 && meta.naturalHeight > 0) {
            if (meta.naturalWidth < 10 && meta.naturalHeight < 10) return;
        }

        if (!this.images.has(src)) {
            this.images.set(src, meta);
        } else {
            // Update if we found better metadata (e.g. dimensions)
            const existing = this.images.get(src)!;
            if (existing.naturalWidth === 0 && meta.naturalWidth > 0) {
                this.images.set(src, meta);
            }
        }
    }
}
