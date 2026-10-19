/**
 * An image's real type from its first bytes. Servers often say `application/octet-stream`, or
 * `image/jpeg` for a WebP; a hotlink block says `text/html`. The bytes decide: '' means not an image.
 */
export function sniffType(bytes: Uint8Array): string {
    const at = (offset: number, ...values: number[]) => values.every((v, i) => bytes[offset + i] === v);
    const ascii = (offset: number, text: string) => [...text].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
    if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
    if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
    if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
    if (ascii(4, 'ftyp')) {
        const brand = String.fromCharCode(...bytes.slice(8, 12));
        if (brand === 'avif' || brand === 'avis') return 'image/avif';
        if (['heic', 'heix', 'mif1', 'msf1', 'hevc'].includes(brand)) return 'image/heic';
    }
    if (ascii(0, 'BM')) return 'image/bmp';
    if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
    if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return 'image/tiff';
    if (at(0, 0xff, 0x0a) || at(0, 0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20)) return 'image/jxl';
    // SVG: text whose first element is <svg> (after an XML declaration, comments, a doctype).
    const head = new TextDecoder().decode(bytes.slice(0, 1024)).replace(/^﻿/, '').trimStart();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return 'image/svg+xml';
    return '';
}
