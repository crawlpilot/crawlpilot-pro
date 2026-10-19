/**
 * A perceptual hash: the picture shrunk to 9×8 grey pixels, one bit per pair of neighbours (is the
 * left one brighter?). The same picture at another size, quality or format gives (nearly) the same 64
 * bits; different pictures differ in many. Hashes are 16 hex characters.
 */

export const HASH_WIDTH = 9;
export const HASH_HEIGHT = 8;
/** At most this many differing bits: the same picture. */
export const SAME_PICTURE = 4;

/** `gray`: 9×8 luminance values, row by row. */
export function dHashFromGray(gray: ArrayLike<number>): string {
    let hi = 0;
    let lo = 0;
    let bit = 0;
    for (let y = 0; y < HASH_HEIGHT; y++) {
        for (let x = 0; x < HASH_WIDTH - 1; x++, bit++) {
            const set = gray[y * HASH_WIDTH + x] > gray[y * HASH_WIDTH + x + 1] ? 1 : 0;
            if (bit < 32) hi = (hi << 1) | set; else lo = (lo << 1) | set;
        }
    }
    return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}

function popcount(n: number): number {
    let v = n >>> 0;
    v -= (v >>> 1) & 0x55555555;
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function hammingDistance(a: string, b: string): number {
    return popcount(parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) + popcount(parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16));
}
