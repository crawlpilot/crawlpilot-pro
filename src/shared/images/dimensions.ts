/**
 * An image's size in pixels from the start of its file, so a candidate can be judged from its first
 * few KB instead of downloading it: PNG, GIF, BMP, ICO, WebP (lossy, lossless, extended), JPEG (the
 * first frame header, after any EXIF), AVIF/HEIC (the largest `ispe` box) and SVG (`width`/`height`,
 * else the `viewBox`). `null` when the bytes don't say (yet: a JPEG with a big EXIF block needs more).
 */
import { sniffType } from './sniff';

export interface Dimensions { width: number; height: number }

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const le32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24));

function jpeg(b: Uint8Array): Dimensions | null {
    let i = 2;
    while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xff) { i++; continue; }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        // Start of frame (not DHT C4, JPG C8, DAC CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: be16(b, i + 5), width: be16(b, i + 7) };
        }
        i += 2 + be16(b, i + 2);
    }
    return null;
}

function webp(b: Uint8Array): Dimensions | null {
    const chunk = String.fromCharCode(...b.slice(12, 16));
    if (chunk === 'VP8 ' && b.length >= 30) return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    if (chunk === 'VP8L' && b.length >= 25) {
        return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
    }
    if (chunk === 'VP8X' && b.length >= 30) return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) };
    return null;
}

/** AVIF/HEIC: image spatial extent boxes; the largest is the primary image (others are thumbnails, tiles). */
function isobmff(b: Uint8Array): Dimensions | null {
    let best: Dimensions | null = null;
    for (let i = 4; i + 16 <= b.length; i++) {
        if (b[i] !== 0x69 || b[i + 1] !== 0x73 || b[i + 2] !== 0x70 || b[i + 3] !== 0x65) continue; // 'ispe'
        const size = { width: be32(b, i + 8), height: be32(b, i + 12) };
        if (!best || size.width * size.height > best.width * best.height) best = size;
    }
    return best;
}

function svg(b: Uint8Array): Dimensions | null {
    const text = new TextDecoder().decode(b.slice(0, 4096));
    const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
    if (!tag) return null;
    const attr = (name: string) => {
        const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(tag);
        return m ? parseFloat(m[1]) : 0;
    };
    const width = attr('width');
    const height = attr('height');
    if (width && height) return { width: Math.round(width), height: Math.round(height) };
    const box = /viewBox\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1].split(/[\s,]+/).map(Number);
    if (box?.length === 4 && box[2] > 0 && box[3] > 0) return { width: Math.round(box[2]), height: Math.round(box[3]) };
    return null;
}

export function imageDimensions(bytes: Uint8Array): Dimensions | null {
    switch (sniffType(bytes)) {
        case 'image/png': return bytes.length >= 24 ? { width: be32(bytes, 16), height: be32(bytes, 20) } : null;
        case 'image/gif': return bytes.length >= 10 ? { width: le16(bytes, 6), height: le16(bytes, 8) } : null;
        case 'image/bmp': return bytes.length >= 26 ? { width: Math.abs(le32(bytes, 18)), height: Math.abs(le32(bytes, 22)) } : null;
        case 'image/x-icon': return bytes.length >= 8 ? { width: bytes[6] || 256, height: bytes[7] || 256 } : null;
        case 'image/webp': return webp(bytes);
        case 'image/jpeg': return jpeg(bytes);
        case 'image/avif':
        case 'image/heic': return isobmff(bytes);
        case 'image/svg+xml': return svg(bytes);
        default: return null;
    }
}
