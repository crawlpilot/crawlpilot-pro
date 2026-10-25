/**
 * Decoding fetched images and drawing them small or re-encoded, on-device. Raster images decode off
 * the main thread (`createImageBitmap`); SVG can't, so it goes through an `<img>`.
 */
import { dHashFromGray, HASH_HEIGHT, HASH_WIDTH } from '../../../shared/images/dhash';
import type { Fetched } from './fetchImage';

export type Decoded = ImageBitmap | HTMLImageElement;

export async function decode(file: Fetched): Promise<Decoded> {
    const blob = new Blob([file.bytes as BlobPart], { type: file.type });
    if (file.type !== 'image/svg+xml') return createImageBitmap(blob);
    const url = URL.createObjectURL(blob);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function sizeOf(image: Decoded): { width: number; height: number } {
    return 'naturalWidth' in image ? { width: image.naturalWidth || 300, height: image.naturalHeight || 150 } : { width: image.width, height: image.height };
}

export function release(image: Decoded) {
    if ('close' in image) image.close();
}

/** The picture's perceptual hash (`shared/images/dhash.ts`). Shrunk in two steps: one step to 9×8 samples too few pixels. */
export async function pixelHash(file: Fetched): Promise<string> {
    const image = await decode(file);
    try {
        const mid = new OffscreenCanvas(64, 64);
        const midCtx = mid.getContext('2d')!;
        midCtx.imageSmoothingQuality = 'high';
        midCtx.fillStyle = '#fff';
        midCtx.fillRect(0, 0, 64, 64);
        midCtx.drawImage(image, 0, 0, 64, 64);
        const small = new OffscreenCanvas(HASH_WIDTH, HASH_HEIGHT);
        const ctx = small.getContext('2d', { willReadFrequently: true })!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(mid, 0, 0, HASH_WIDTH, HASH_HEIGHT);
        const { data } = ctx.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT);
        const gray = new Array<number>(HASH_WIDTH * HASH_HEIGHT);
        for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
        return dHashFromGray(gray);
    } finally {
        release(image);
    }
}
