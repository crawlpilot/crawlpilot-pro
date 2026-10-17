/** Image Downloader: a deep scan (scrolls the page) and a live watch, streaming batches to the side panel. */
import { ProgressiveImageScanner } from '../features/universal-images/ProgressiveImageScanner';
import { fail, ok, on, send } from '../../shared/messages';

let scanner: ProgressiveImageScanner | null = null;

function stopScanner() {
    scanner?.cancel();
    scanner?.stopLiveWatch();
    scanner = null;
}

export function registerImageHandlers() {
    on('SCAN_IMAGES_DEEP', async (options = {}) => {
        scanner = new ProgressiveImageScanner();
        try {
            const images = await scanner.scan(
                progress => { void send('SCAN_IMAGES_PROGRESS', progress); },
                {
                    scrollStep: options.scrollStep || 800,
                    scrollDelay: options.scrollDelay || 100,
                    maxScrollHeight: options.maxScrollHeight || 50000,
                    watchDuration: options.watchDuration ?? 3000
                },
                batch => { void send('SCAN_IMAGES_BATCH', batch); }
            );
            return ok({ data: images });
        } catch (error) {
            return fail(error);
        } finally {
            scanner = null;
        }
    });

    on('SCAN_IMAGES_DEEP_CANCEL', () => { stopScanner(); return ok(); });

    on('SCAN_IMAGES_LIVE_START', () => {
        scanner = new ProgressiveImageScanner();
        scanner.startLiveWatch(batch => { void send('SCAN_IMAGES_BATCH', batch); });
        return ok();
    });

    on('SCAN_IMAGES_LIVE_STOP', () => { stopScanner(); return ok(); });
}
