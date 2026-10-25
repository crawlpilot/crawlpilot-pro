/** An image onto the clipboard. The clipboard takes PNG only, so other types are converted first. */
import type { Fetched } from './fetchImage';

export async function copyImageToClipboard(fetchBytes: () => Promise<Fetched>): Promise<void> {
    const file = await fetchBytes();
    let blob = new Blob([file.bytes as BlobPart], { type: file.type });
    if (file.type !== 'image/png') {
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        bitmap.close();
        blob = await canvas.convertToBlob({ type: 'image/png' });
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
