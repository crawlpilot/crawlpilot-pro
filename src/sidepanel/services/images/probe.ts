/**
 * What a URL holds, from its first bytes: the real type, the size in pixels and the file size. Asks
 * for a byte range, and stops reading after enough bytes whether or not the server honours it, so
 * judging a 20 MB original costs about 128 KB. `null` when it isn't a readable image.
 */
import { imageDimensions, type Dimensions } from '../../../shared/images/dimensions';
import { sniffType } from '../../../shared/images/sniff';

const FIRST_BYTES = 128 * 1024;
/** A JPEG whose EXIF (with its own thumbnail) pushes the frame header further. */
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;

export interface Probe {
    url: string;
    type: string;
    width: number;
    height: number;
    bytes?: number;
}

function totalSize(response: Response): number | undefined {
    const range = response.headers.get('content-range');
    const total = range ? Number(range.split('/')[1]) : response.status === 200 ? Number(response.headers.get('content-length')) : NaN;
    return Number.isFinite(total) && total > 0 ? total : undefined;
}

export async function probeImage(url: string, signal: AbortSignal, fetchFn: typeof fetch = fetch): Promise<Probe | null> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort);
    const timer = setTimeout(abort, TIMEOUT_MS);
    try {
        const response = await fetchFn(url, { credentials: 'include', signal: controller.signal, headers: { Range: `bytes=0-${FIRST_BYTES - 1}` } });
        if (response.status !== 200 && response.status !== 206) return null;
        const reader = response.body?.getReader();
        if (!reader) return null;
        const chunks: Uint8Array[] = [];
        let length = 0;
        let bytes = new Uint8Array(0);
        let size: Dimensions | null = null;
        while (length < MAX_BYTES) {
            const { done, value } = await reader.read();
            if (value) { chunks.push(value); length += value.length; }
            if (done || length >= FIRST_BYTES) {
                bytes = new Uint8Array(length);
                let at = 0;
                for (const c of chunks) { bytes.set(c, at); at += c.length; }
                size = imageDimensions(bytes);
                if (done || size || sniffType(bytes) !== 'image/jpeg') break;
            }
        }
        void reader.cancel().catch(() => undefined);
        const type = sniffType(bytes);
        if (!type) return null;
        return { url, type, width: size?.width ?? 0, height: size?.height ?? 0, bytes: totalSize(response) };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
    }
}
