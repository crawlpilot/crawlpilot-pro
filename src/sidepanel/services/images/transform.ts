/**
 * Converting and resizing images before they are saved, on-device: to JPG, PNG or WebP, and down to a
 * longest side. Re-encoding drops the file's metadata (EXIF: camera, location). Untouched when nothing
 * is asked of it, or when the image already fits and keeps its format: the original bytes, metadata
 * and all. Animated GIF and WebP are never flattened to one frame: they are kept as they are.
 */
import { decode, release, sizeOf } from './pixels';
import type { Fetched } from './fetchImage';

export type OutputFormat = 'original' | 'jpeg' | 'png' | 'webp';

export interface Processing {
    format: OutputFormat;
    /** 0–1, for JPG and WebP. */
    quality: number;
    /** Longest side in pixels; 0 keeps the size. */
    maxSide: number;
}

export const NO_PROCESSING: Processing = { format: 'original', quality: 0.9, maxSide: 0 };

export function asksForWork(p: Processing): boolean {
    return p.format !== 'original' || p.maxSide > 0;
}

/** Whether a GIF or WebP has more than one frame. */
export function isAnimated(bytes: Uint8Array, type: string): boolean {
    if (type === 'image/webp') return bytes.length > 20 && String.fromCharCode(...bytes.slice(12, 16)) === 'VP8X' && (bytes[20] & 0x02) !== 0;
    if (type !== 'image/gif') return false;
    // More than one image descriptor (0x2C after a graphic control extension 0x21 0xF9).
    let frames = 0;
    for (let i = 0; i + 9 < bytes.length && frames < 2; i++) {
        if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && bytes[i + 7] === 0x00 && bytes[i + 8] === 0x2c) frames++;
    }
    return frames > 1;
}

export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
    const longest = Math.max(width, height);
    if (!maxSide || longest <= maxSide) return { width, height };
    const scale = maxSide / longest;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const ENCODABLE = ['image/jpeg', 'image/png', 'image/webp'];

export type ProcessResult = { file: Fetched; outcome: 'kept' | 'converted' | 'animated' };

export async function processImage(file: Fetched, p: Processing): Promise<ProcessResult> {
    if (!asksForWork(p)) return { file, outcome: 'kept' };
    if (isAnimated(file.bytes, file.type)) return { file, outcome: 'animated' };
    const target = p.format === 'original' ? (ENCODABLE.includes(file.type) ? file.type : 'image/png') : `image/${p.format}`;
    const image = await decode(file);
    try {
        const size = sizeOf(image);
        const out = fitWithin(size.width, size.height, p.maxSide);
        if (target === file.type && out.width === size.width && out.height === size.height) return { file, outcome: 'kept' };
        const canvas = new OffscreenCanvas(out.width, out.height);
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        // JPG has no transparency: white, not black, behind transparent pixels.
        if (target === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height); }
        ctx.drawImage(image, 0, 0, out.width, out.height);
        const blob = await canvas.convertToBlob({ type: target, quality: p.quality });
        return { file: { ...file, bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || target }, outcome: 'converted' };
    } finally {
        release(image);
    }
}
