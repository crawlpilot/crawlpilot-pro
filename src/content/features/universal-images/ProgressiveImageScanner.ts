import { ImageScanner, ImageMeta } from './ImageScanner';

export interface ScanProgress {
    phase: 'starting' | 'scrolling' | 'scanning' | 'watching' | 'complete' | 'cancelled';
    scrollPercent: number;
    imagesFound: number;
    newInThisStep: number;
}

export interface DeepScanOptions {
    scrollStep?: number;        // px per scroll increment (default: 800)
    scrollDelay?: number;       // ms wait after each scroll (default: 100)
    maxScrollHeight?: number;   // cap in px to prevent infinite loops (default: 50000)
    watchDuration?: number;     // ms to watch for new images after scroll completes (default: 3000)
}

/**
 * Progressive image scanner that auto-scrolls the page and accumulates
 * images across scroll positions. Handles lazy-loaded content and
 * virtual list SPAs (LinkedIn, Instagram) where older DOM nodes are
 * removed as new ones appear.
 *
 * Streams image batches back via onBatch callback as they're discovered.
 */
export class ProgressiveImageScanner {
    private cancelled = false;
    private observer: MutationObserver | null = null;

    /**
     * Runs a full-page progressive scan with streaming.
     * @param onProgress callback for each scroll step (counts only)
     * @param options scroll configuration
     * @param onBatch optional callback that receives new ImageMeta[] as they're found
     * @returns all accumulated images
     */
    async scan(
        onProgress: (update: ScanProgress) => void,
        options: DeepScanOptions = {},
        onBatch?: (newImages: ImageMeta[]) => void
    ): Promise<ImageMeta[]> {
        const scrollStep = options.scrollStep ?? 800;
        const scrollDelay = options.scrollDelay ?? 100;
        const maxScrollHeight = options.maxScrollHeight ?? 50000;
        const watchDuration = options.watchDuration ?? 3000;
        this.cancelled = false;

        // Reset accumulator
        ImageScanner.reset();

        // Save current scroll position
        const originalScrollY = window.scrollY;

        onProgress({ phase: 'starting', scrollPercent: 0, imagesFound: 0, newInThisStep: 0 });

        // Scroll to top first
        window.scrollTo({ top: 0, behavior: 'auto' });
        await this.wait(200);

        // Initial scan at top
        const initialDelta = ImageScanner.scanMerge();
        if (initialDelta.length > 0 && onBatch) onBatch(initialDelta);
        onProgress({
            phase: 'scanning',
            scrollPercent: 0,
            imagesFound: ImageScanner.getAll().length,
            newInThisStep: initialDelta.length
        });

        // Calculate total scrollable height (capped)
        let maxScroll = Math.min(this.getMaxScroll(), maxScrollHeight);
        let currentScroll = 0;

        // Scroll loop
        while (currentScroll < maxScroll && !this.cancelled) {
            currentScroll += scrollStep;
            window.scrollTo({ top: currentScroll, behavior: 'auto' });

            await this.wait(scrollDelay);

            // Scan at this position
            const delta = ImageScanner.scanMerge();
            if (delta.length > 0 && onBatch) onBatch(delta);

            // Recalculate max scroll (page may have grown due to infinite scroll), still capped
            const newMax = Math.min(this.getMaxScroll(), maxScrollHeight);
            if (newMax > maxScroll) {
                maxScroll = newMax;
            }

            const scrollPercent = Math.min(100, Math.round((currentScroll / maxScroll) * 100));
            onProgress({
                phase: 'scrolling',
                scrollPercent,
                imagesFound: ImageScanner.getAll().length,
                newInThisStep: delta.length
            });
        }

        // Final scan at bottom
        if (!this.cancelled) {
            const finalDelta = ImageScanner.scanMerge();
            if (finalDelta.length > 0 && onBatch) onBatch(finalDelta);
        }

        // --- Post-scroll MutationObserver phase ---
        // Watch for lazy images that load AFTER scroll completes (IntersectionObserver-triggered, deferred loads)
        if (!this.cancelled && watchDuration > 0) {
            onProgress({
                phase: 'watching',
                scrollPercent: 100,
                imagesFound: ImageScanner.getAll().length,
                newInThisStep: 0
            });
            await this.watchForNewImages(watchDuration, onProgress, onBatch);
        }

        // Restore scroll position
        window.scrollTo({ top: originalScrollY, behavior: 'auto' });

        const allImages = ImageScanner.getAll();

        onProgress({
            phase: this.cancelled ? 'cancelled' : 'complete',
            scrollPercent: 100,
            imagesFound: allImages.length,
            newInThisStep: 0
        });

        return allImages;
    }

    /** Cancel an in-progress scan. */
    cancel(): void {
        this.cancelled = true;
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

    /**
     * Starts a standalone live MutationObserver that streams new images
     * as they appear in the DOM. Used for SPA live-watch mode.
     * Call cancel() or stopLiveWatch() to terminate.
     */
    startLiveWatch(onBatch: (newImages: ImageMeta[]) => void): void {
        this.cancelled = false;
        ImageScanner.reset();
        // Initial scan
        const initial = ImageScanner.scan();
        if (initial.length > 0) onBatch(initial);

        this.observer = new MutationObserver(() => {
            if (this.cancelled) return;
            const delta = ImageScanner.scanMerge();
            if (delta.length > 0) onBatch(delta);
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'srcset', 'style', 'data-src', 'data-lazy-src']
        });
    }

    stopLiveWatch(): void {
        this.cancel();
    }

    private async watchForNewImages(
        duration: number,
        onProgress: (update: ScanProgress) => void,
        onBatch?: (newImages: ImageMeta[]) => void
    ): Promise<void> {
        return new Promise(resolve => {
            const timeout = setTimeout(() => {
                if (this.observer) {
                    this.observer.disconnect();
                    this.observer = null;
                }
                resolve();
            }, duration);

            this.observer = new MutationObserver(() => {
                if (this.cancelled) {
                    clearTimeout(timeout);
                    this.observer?.disconnect();
                    this.observer = null;
                    resolve();
                    return;
                }
                const delta = ImageScanner.scanMerge();
                if (delta.length > 0) {
                    if (onBatch) onBatch(delta);
                    onProgress({
                        phase: 'watching',
                        scrollPercent: 100,
                        imagesFound: ImageScanner.getAll().length,
                        newInThisStep: delta.length
                    });
                }
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'srcset', 'style', 'data-src', 'data-lazy-src']
            });
        });
    }

    private getMaxScroll(): number {
        return Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight
        ) - window.innerHeight;
    }

    private wait(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
