import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { send } from '../../../shared/messages';
import type { ImageMeta } from '../../../content/features/universal-images/ImageScanner';
import { getExtension } from './imageFilters';

/** Downloads one image with chrome.downloads, or saves it from the page when that fails. */
export async function downloadImage(url: string) {
    const filename = `image-${Date.now()}.${getExtension(url)}`;
    const response = await send('DOWNLOAD_VIA_CHROME', { url, filename });
    if (!response?.success) saveAs(url, filename);
}

/** The image's bytes: fetched directly, or through the background when CORS blocks it. */
async function imageBlob(src: string): Promise<Blob | null> {
    try {
        const resp = await fetch(src, { mode: 'cors' });
        if (!resp.ok) throw new Error('CORS');
        return await resp.blob();
    } catch {
        const proxied = await send('DOWNLOAD_IMAGE_PROXY', { url: src });
        return proxied?.success && proxied.data ? new Blob([new Uint8Array(proxied.data)], { type: proxied.contentType || 'image/jpeg' }) : null;
    }
}

/** Saves the images as one zip; images that can't be fetched are skipped. */
export async function downloadZip(images: ImageMeta[], zipName: string) {
    const zip = new JSZip();
    let count = 0;
    for (const img of images) {
        const blob = await imageBlob(img.src).catch(() => null);
        if (!blob) continue;
        count++;
        const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || getExtension(img.src);
        zip.file(`image_${count}.${ext}`, blob);
    }
    if (count > 0) saveAs(await zip.generateAsync({ type: 'blob' }), zipName);
}
