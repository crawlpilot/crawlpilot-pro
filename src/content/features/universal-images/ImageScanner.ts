export interface ImageMeta {
    src: string;
    naturalWidth: number;
    naturalHeight: number;
    alt?: string;
    type?: string;
    sizeBytes?: number;
    element: 'img' | 'video' | 'bg' | 'svg' | 'source';
    pageUrl: string;
    isVisible?: boolean;
}

export class ImageScanner {
    private static images: Map<string, ImageMeta> = new Map();
    private static pageUrl: string = '';

    public static scan(): ImageMeta[] {
        this.images.clear();
        this.pageUrl = window.location.href;

        // Start scanning from the body
        this.scanElement(document.body);

        return Array.from(this.images.values());
    }

    private static scanElement(root: Element | ShadowRoot) {
        if (!root) return;

        // 1. Scan children
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
            const img = el as HTMLImageElement;
            const src = this.getBestSrc(img);
            if (this.isValidUrl(src)) {
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

                // If still 0x0, it's likely invisible/stale - skip it
                if (width === 0 && height === 0) return;

                this.addImage(src, {
                    src,
                    naturalWidth: width,
                    naturalHeight: height,
                    alt: img.alt,
                    element: 'img',
                    pageUrl: this.pageUrl
                });
            }
        }

        // 2. <picture> -> <source> tags
        if (tagName === 'source') {
            const source = el as HTMLSourceElement;
            const src = this.getSrcSetMax(source.srcset) || source.src;
            if (this.isValidUrl(src)) {
                // Try to get dimensions from parent picture or img sibling
                const parent = source.closest('picture');
                const siblingImg = parent?.querySelector('img');

                let width = siblingImg?.naturalWidth || 0;
                let height = siblingImg?.naturalHeight || 0;

                // Fallback: Check sibling attributes
                if (width === 0 && siblingImg) {
                    width = parseInt(siblingImg.getAttribute('width') || '0', 10);
                    height = parseInt(siblingImg.getAttribute('height') || '0', 10);
                }

                // Fallback: Check sibling rendered size
                if (width === 0 && siblingImg) {
                    const rect = siblingImg.getBoundingClientRect();
                    width = Math.round(rect.width);
                    height = Math.round(rect.height);
                }

                // Ignore if truly invisible
                if (width === 0 && height === 0) return;

                this.addImage(src, {
                    src,
                    naturalWidth: width,
                    naturalHeight: height,
                    alt: siblingImg?.alt || 'Source Image',
                    element: 'source',
                    pageUrl: this.pageUrl
                });
            }
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

        // 4. SVGs
        if (tagName === 'svg') {
            // ... (keep existing comment)
        }

        // 5. Background Images
        this.scanBackgroundImage(el);
    }

    private static scanBackgroundImage(el: Element) {
        const style = window.getComputedStyle(el);
        const bgImage = style.backgroundImage;

        if (bgImage && bgImage !== 'none') {
            // Check if element is visible
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            // Handle multiple backgrounds: url(...), url(...)
            const matches = bgImage.matchAll(/url\((['"]?)(.*?)\1\)/g);
            for (const match of matches) {
                const url = match[2];
                if (this.isValidUrl(url)) {
                    // Dimensions are unknown for BG images without loading
                    this.addImage(url, {
                        src: url,
                        naturalWidth: 0,
                        naturalHeight: 0,
                        alt: 'Background Image',
                        element: 'bg',
                        pageUrl: this.pageUrl
                    });
                }
            }
        }
    }

    private static getBestSrc(img: HTMLImageElement): string {
        if (img.currentSrc) return img.currentSrc; // Browser-selected best candidate
        if (img.srcset) return this.getSrcSetMax(img.srcset) || img.src;
        return img.src;
    }

    private static getSrcSetMax(srcset: string): string | null {
        if (!srcset) return null;
        try {
            const sources = srcset.split(',').map(s => {
                const parts = s.trim().split(/\s+/);
                const url = parts[0];
                const cleanUrl = url.replace(/['"]/g, ''); // Ensure no quotes in URL

                let width = 0;
                if (parts.length > 1) {
                    const desc = parts[1];
                    if (desc.endsWith('w')) width = parseInt(desc.slice(0, -1), 10);
                    // 'x' descriptors (density) are harder to map to resolution without base size, but we assume higher density ~ higher res
                    if (desc.endsWith('x')) width = parseFloat(desc.slice(0, -1)) * 1000;
                }
                return { url: cleanUrl, width };
            });

            if (sources.length === 0) return null;

            // Sort by width descending
            sources.sort((a, b) => b.width - a.width);
            return sources[0]?.url || null;
        } catch (e) {
            console.warn('Failed to parse srcset', e);
            return null;
        }
    }

    private static isValidUrl(url: string | undefined | null): boolean {
        if (!url) return false;
        if (url.startsWith('data:')) return false; // Skip data URIs for now (unless requested)
        if (url.length < 5) return false;
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
