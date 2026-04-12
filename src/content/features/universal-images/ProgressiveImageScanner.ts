import { ImageScanner, ImageMeta } from './ImageScanner';

export interface ScanProgress {
    phase: 'starting' | 'scrolling' | 'scanning' | 'complete' | 'cancelled';
    scrollPercent: number;
    imagesFound: number;
    newInThisStep: number;
}

export interface DeepScanOptions {
    scrollStep?: number;    // px per scroll increment (default: 800)
    scrollDelay?: number;   // ms wait after each scroll (default: 100)
}

/**
 * Progressive image scanner that auto-scrolls the page and accumulates
 * images across scroll positions. Handles lazy-loaded content and
 * virtual list SPAs (LinkedIn, Instagram) where older DOM nodes are
 * removed as new ones appear.
 */
export class ProgressiveImageScanner {
    private cancelled = false;

    /**
     * Runs a full-page progressive scan.
     * @param onProgress callback for each scroll step
     * @param options scroll configuration
     * @returns all accumulated images
     */
    async scan(
        onProgress: (update: ScanProgress) => void,
        options: DeepScanOptions = {}
    ): Promise<ImageMeta[]> {
        const scrollStep = options.scrollStep ?? 800;
        const scrollDelay = options.scrollDelay ?? 100;
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
        onProgress({
            phase: 'scanning',
            scrollPercent: 0,
            imagesFound: ImageScanner.getAll().length,
            newInThisStep: initialDelta.length
        });

        // Calculate total scrollable height
        let maxScroll = this.getMaxScroll();
        let currentScroll = 0;

        // Scroll loop
        while (currentScroll < maxScroll && !this.cancelled) {
            currentScroll += scrollStep;
            window.scrollTo({ top: currentScroll, behavior: 'auto' });

            await this.wait(scrollDelay);

            // Scan at this position
            const delta = ImageScanner.scanMerge();

            // Recalculate max scroll (page may have grown due to infinite scroll)
            const newMax = this.getMaxScroll();
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
            ImageScanner.scanMerge();
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
