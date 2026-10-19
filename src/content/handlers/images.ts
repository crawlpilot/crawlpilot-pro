/**
 * Image Downloader: a quick read of the page, a deep scan (scrolls so lazy images load) and a live
 * watch, streaming `{added, updated}` batches to the side panel. One session per page until the next
 * quick scan; the deep scan and the live watch add to it.
 *
 * `SHOW_IMAGE` scrolls to an image and outlines it for a moment.
 *
 * `FETCH_IMAGE` is the side panel's fallback for images it can't fetch itself: the page's fetch
 * carries the page's `Referer` and session, and can read the page's `blob:` URLs.
 */
import { ImageScanSession } from '../services/images/session';
import { fail, ok, on, send } from '../../shared/messages';

/** Larger files go through the side panel's own fetch (a data URL this size is already slow to pass). */
const PAGE_FETCH_MAX = 64 * 1024 * 1024;

const OUTLINE_MS = 2500;

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

    on('SHOW_IMAGE', ({ src }) => {
        const el = session?.collector.elementFor(src);
        if (!el) return fail('This image isn\'t shown on the page (page data, an icon, or since removed)');
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
        outline(el);
        return ok();
    });

    on('FETCH_IMAGE', async ({ url }) => {
        try {
            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) return { ...fail(`HTTP ${response.status}`), status: response.status };
            const blob = await response.blob();
            if (blob.size > PAGE_FETCH_MAX) return fail('Too large to pass from the page');
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });
            return ok({ dataUrl });
        } catch (error) {
            return fail(error);
        }
    });
}

/** A box drawn over `el` (offset by its frame when it is in a same-origin iframe), removed after a moment. */
function outline(el: Element) {
    const rect = el.getBoundingClientRect();
    const frame = el.ownerDocument.defaultView?.frameElement?.getBoundingClientRect();
    const box = document.createElement('div');
    Object.assign(box.style, {
        position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', boxSizing: 'border-box',
        left: `${rect.left + (frame?.left ?? 0) - 4}px`, top: `${rect.top + (frame?.top ?? 0) - 4}px`,
        width: `${Math.max(rect.width, 16) + 8}px`, height: `${Math.max(rect.height, 16) + 8}px`,
        border: '3px solid #f59e0b', borderRadius: '6px', boxShadow: '0 0 0 9999px rgba(0,0,0,0.25)', transition: 'opacity 0.3s',
    });
    document.documentElement.append(box);
    setTimeout(() => { box.style.opacity = '0'; }, OUTLINE_MS - 300);
    setTimeout(() => box.remove(), OUTLINE_MS);
}
