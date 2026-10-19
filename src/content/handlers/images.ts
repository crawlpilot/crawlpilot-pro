/**
 * Image Downloader: a quick read of the page, a deep scan (scrolls so lazy images load) and a live
 * watch, streaming `{added, updated}` batches to the side panel. One session per page until the next
 * quick scan; the deep scan and the live watch add to it.
 */
import { ImageScanSession } from '../services/images/session';
import { fail, ok, on, send } from '../../shared/messages';

let session: ImageScanSession | null = null;
let running: AbortController | null = null;

function current(): ImageScanSession {
    session ??= new ImageScanSession(batch => { void send('SCAN_IMAGES_BATCH', batch); });
    return session;
}

/** Sizes the markup didn't give, in the background of the reply. */
function measure() {
    const controller = new AbortController();
    running = controller;
    void current().measure(controller.signal)
        .finally(() => { if (running === controller) running = null; });
}

export function registerImageHandlers() {
    on('SCAN_IMAGES', () => {
        running?.abort();
        session?.unwatch();
        session = null;
        const images = current().quick();
        measure();
        return ok({ images });
    });

    on('SCAN_IMAGES_DEEP', async () => {
        running?.abort();
        const controller = new AbortController();
        running = controller;
        try {
            const images = await current().deep(controller.signal, progress => { void send('SCAN_IMAGES_PROGRESS', progress); });
            void send('SCAN_IMAGES_PROGRESS', { phase: controller.signal.aborted ? 'cancelled' : 'complete', percent: 100, found: images.length });
            if (!controller.signal.aborted) measure();
            return ok({ images });
        } catch (error) {
            return fail(error);
        } finally {
            if (running === controller) running = null;
        }
    });

    on('SCAN_IMAGES_CANCEL', () => { running?.abort(); return ok(); });

    on('SCAN_IMAGES_LIVE_START', () => { current().watch(true); return ok(); });

    on('SCAN_IMAGES_LIVE_STOP', () => { session?.unwatch(); return ok(); });
}
