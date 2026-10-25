/**
 * Saves a selection of images: fetched 6 at a time (2 per host), named from a template, and written
 * either one file at a time into `Downloads/CrawlPilot/…` or into one zip that is built as files
 * arrive. Every image ends saved or failed with a reason; nothing is skipped silently.
 *
 * An image with a full-size original (`image.full`) is saved from the original, named after it; if
 * the original can't be had, the file shown on the page is saved instead and counted as `downgraded`.
 *
 * With `processing`, each file is converted or resized first (`transform.ts`).
 *
 * With `manifest`, a `manifest.csv` goes with the files: each file's name, URL, page, alt text and size.
 */
import type { FoundImage } from '../../../shared/images/types';
import { guessType, typeLabel } from '../../../shared/images/type';
import { sendToTab } from '../../../shared/messages';
import { fetchImage, FetchFailure, type FailReason, type Fetched, type InPage } from './fetchImage';
import { NameBook, renderName, today } from './naming';
import { hostKey, runPool } from './pool';
import { ZipWriter } from './zip';
import { processImage, type Processing } from './transform';

export type SaveMode = 'zip' | 'folder';

/** Above this many images the default is a folder: a zip that size is slow to open and easy to lose. */
export const FOLDER_ABOVE = 200;
const ROOT = 'CrawlPilot';

export interface SaveProgress {
    done: number;
    failed: number;
    total: number;
    bytes: number;
}

export interface SaveFailure {
    src: string;
    reason: FailReason;
    status?: number;
}

export interface SavedFile {
    file: string;
    image: FoundImage;
    src: string;
    type: string;
    bytes: number;
}

export interface SaveReport extends SaveProgress {
    files: SavedFile[];
    failures: SaveFailure[];
    /** Saved at the size shown because the full-size original failed. */
    downgraded: number;
    /** Converted or resized. */
    converted: number;
    /** Animated GIF/WebP kept as they are instead of being converted. */
    keptAnimated: number;
    stopped: boolean;
    /** Where the files went: the zip's name, or the folder. */
    target: string;
}

export interface SaveOptions {
    mode: SaveMode;
    template: string;
    pageTitle: string;
    signal: AbortSignal;
    manifest?: boolean;
    processing?: Processing;
    onProgress?: (p: SaveProgress) => void;
}

export interface SaveDeps {
    fetch: (url: string, signal: AbortSignal) => Promise<Fetched>;
    /** Saves a Blob under `filename` (relative to Downloads); rejects if Chrome couldn't. */
    download: (blob: Blob, filename: string) => Promise<void>;
}

export const FAIL_REASONS: Record<FailReason, string> = {
    login: 'Needs a login the browser doesn\'t have',
    blocked: 'The server refused (hotlink protection or no access)',
    'not-found': 'Gone from the server (404)',
    timeout: 'Timed out',
    'not-image': 'Not an image (the server sent a web page)',
    server: 'Server error or rate limit, still failing after retries',
    network: 'Network error',
    'too-large': 'Larger than 200 MB',
    save: 'Chrome couldn\'t save the file',
    stopped: 'Stopped',
};

function siteOf(images: FoundImage[]): string {
    try { return new URL(images[0]?.pageUrl ?? '').hostname.replace(/^www\./, '') || 'images'; } catch { return 'images'; }
}

/** Chrome's download of a Blob, resolved when the file is on disk. */
function chromeDownload(blob: Blob, filename: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    return new Promise<void>((resolve, reject) => {
        let id: number | undefined;
        const done = (error?: string) => {
            chrome.downloads.onChanged.removeListener(listener);
            URL.revokeObjectURL(url);
            if (error) reject(new FetchFailure('save')); else resolve();
        };
        const listener = (delta: chrome.downloads.DownloadDelta) => {
            if (delta.id !== id) return;
            if (delta.state?.current === 'complete') done();
            else if (delta.state?.current === 'interrupted') done(delta.error?.current || 'interrupted');
        };
        chrome.downloads.onChanged.addListener(listener);
        chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false })
            .then(downloadId => { id = downloadId; })
            .catch(e => done(String(e)));
    });
}

/** The real browser: fetches from the side panel, falls back to the page in `tabId`. */
export function browserDeps(tabId: number | null): SaveDeps {
    const inPage: InPage | undefined = tabId === null ? undefined : async url => {
        try {
            const reply = await sendToTab(tabId, 'FETCH_IMAGE', { url });
            return reply.success ? { dataUrl: reply.dataUrl } : { error: reply.error, status: reply.status };
        } catch (e) {
            return { error: String(e) };
        }
    };
    return {
        fetch: (url, signal) => fetchImage(url, { signal, inPage }),
        download: chromeDownload,
    };
}

export async function saveImages(images: FoundImage[], options: SaveOptions, deps: SaveDeps): Promise<SaveReport> {
    const { mode, template, pageTitle, signal, onProgress, manifest, processing } = options;
    const date = today();
    const site = siteOf(images);
    const names = new NameBook();
    const zip = mode === 'zip' ? new ZipWriter() : null;
    const target = mode === 'zip' ? `${site}-images-${date}.zip` : `${ROOT}/${site}`;
    const progress: SaveProgress = { done: 0, failed: 0, total: images.length, bytes: 0 };
    const failures: SaveFailure[] = [];
    const started = new Set<number>();
    let downgraded = 0;
    let converted = 0;
    let keptAnimated = 0;
    const files: SavedFile[] = [];

    await runPool(images, img => hostKey(img.src), async (image, index) => {
        started.add(index);
        try {
            let named = image.full ? { ...image, src: image.full.src, width: image.full.width, height: image.full.height } : image;
            let file: Fetched;
            try {
                file = await deps.fetch(named.src, signal);
            } catch (e) {
                if (!image.full || signal.aborted) throw e;
                file = await deps.fetch(image.src, signal);
                named = image;
                downgraded++;
            }
            if (processing) {
                const result = await processImage(file, processing).catch(() => ({ file, outcome: 'kept' as const }));
                file = result.file;
                if (result.outcome === 'converted') converted++;
                if (result.outcome === 'animated') keptAnimated++;
            }
            const ext = typeLabel(file.type) || typeLabel(guessType(named.src)) || 'jpg';
            const path = names.claim(renderName(template, { image: named, n: index + 1, total: images.length, pageTitle, date }), ext);
            if (zip) zip.add(path, file.bytes);
            else await deps.download(new Blob([file.bytes as BlobPart], { type: file.type }), `${target}/${path}`);
            files.push({ file: path, image, src: named.src, type: file.type, bytes: file.bytes.length });
            progress.done++;
            progress.bytes += file.bytes.length;
        } catch (e) {
            const failure = e instanceof FetchFailure ? e : new FetchFailure('network');
            failures.push({ src: image.src, reason: signal.aborted ? 'stopped' : failure.reason, status: failure.status });
            progress.failed++;
        }
        onProgress?.({ ...progress });
    }, { signal });

    const csv = manifest && files.length ? new TextEncoder().encode(manifestCsv(files)) : null;
    if (csv && !zip) await deps.download(new Blob([csv as BlobPart], { type: 'text/csv' }), `${target}/manifest.csv`).catch(() => undefined);
    if (zip && progress.done > 0) {
        if (csv) zip.add('manifest.csv', csv);
        try {
            await deps.download(await zip.finish(), target);
        } catch {
            // The zip itself didn't save: every file in it is lost.
            return { ...progress, done: 0, failed: images.length, failures: images.map(i => ({ src: i.src, reason: 'save' as const })), files: [], downgraded: 0, converted: 0, keptAnimated: 0, stopped: signal.aborted, target };
        }
    }
    // Images a stop kept from starting.
    images.forEach((image, index) => {
        if (started.has(index)) return;
        failures.push({ src: image.src, reason: 'stopped' });
        progress.failed++;
    });
    return { ...progress, files, failures, downgraded, converted, keptAnimated, stopped: signal.aborted, target };
}

/** The output a selection of this size gets by default. */
export function defaultMode(count: number): SaveMode {
    return count > FOLDER_ABOVE ? 'folder' : 'zip';
}

const csvCell = (v: unknown) => {
    const text = v === undefined || v === null ? '' : String(v);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** One row per saved file, in selection order. */
export function manifestCsv(files: SavedFile[]): string {
    const header = ['file', 'url', 'shown_url', 'page', 'alt', 'caption', 'section', 'width', 'height', 'type', 'bytes'];
    const rows = [...files].sort((a, b) => a.image.order - b.image.order).map(f => {
        const size = f.src === f.image.full?.src ? f.image.full : f.image;
        const src = f.src.startsWith('data:') ? '' : f.src;
        return [f.file, src, f.image.src.startsWith('data:') ? '' : f.image.src, f.image.pageUrl, f.image.alt, f.image.caption, f.image.heading, size.width || '', size.height || '', f.type, f.bytes];
    });
    return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
