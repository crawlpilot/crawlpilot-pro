import { describe, it, expect } from 'vitest';
import { dHashFromGray, hammingDistance } from '../../../shared/images/dhash';
import { canonicalUrl, foldDuplicates } from '../../../shared/images/dedupe';
import type { FoundImage } from '../../../shared/images/types';
import { asksForWork, fitWithin, isAnimated, NO_PROCESSING } from './transform';

const image = (src: string, width: number, height: number, order: number, extra: Partial<FoundImage> = {}): FoundImage =>
    ({ src, variants: [], width, height, type: '', origin: 'img', hidden: false, order, pageUrl: 'https://shop.test/', ...extra });

/** 9×8 grey values from a function of the column. */
const gray = (f: (x: number) => number) => Array.from({ length: 72 }, (_, i) => f(i % 9));

describe('dHash', () => {
    it('is the same for the same picture at another brightness, far for a different one', () => {
        const ramp = dHashFromGray(gray(x => x * 20));
        const brighter = dHashFromGray(gray(x => x * 20 + 30));
        const reversed = dHashFromGray(gray(x => 200 - x * 20));
        expect(ramp).toMatch(/^[0-9a-f]{16}$/);
        expect(hammingDistance(ramp, brighter)).toBe(0);
        expect(hammingDistance(ramp, reversed)).toBe(64);
    });
});

describe('foldDuplicates', () => {
    it('folds size variants of one URL into the largest, and keeps page order', () => {
        const images = [
            image('https://cdn.test/a.jpg?w=300', 300, 200, 0),
            image('https://cdn.test/b.jpg', 500, 500, 1),
            image('https://cdn.test/a.jpg?w=1200', 1200, 800, 2),
            image('https://blog.test/wp-content/uploads/c-300x200.jpg', 300, 200, 3),
            image('https://blog.test/wp-content/uploads/c.jpg', 0, 0, 4),
        ];
        const kept = foldDuplicates(images);
        expect(kept.map(i => [i.src.replace(/^https:\/\/[^/]+/, ''), i.duplicates?.length ?? 0])).toEqual([
            ['/b.jpg', 0], ['/a.jpg?w=1200', 1], ['/wp-content/uploads/c-300x200.jpg', 1],
        ]);
        expect(canonicalUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    });

    it('folds look-alikes by pixel hash across unrelated URLs; leaves different pictures alone', () => {
        const images = [image('https://x.test/cat.jpg', 300, 200, 0), image('https://y.test/kitty.webp', 600, 400, 1), image('https://x.test/dog.jpg', 300, 200, 2)];
        const hashes = new Map([
            ['https://x.test/cat.jpg', 'f0f0f0f0aaaaaaaa'],
            ['https://y.test/kitty.webp', 'f0f0f0f1aaaaaaab'], // 2 bits off: same picture
            ['https://x.test/dog.jpg', '0f0f0f0f55555555'],
        ]);
        expect(foldDuplicates(images, hashes).map(i => [i.src, i.duplicates])).toEqual([
            ['https://y.test/kitty.webp', ['https://x.test/cat.jpg']],
            ['https://x.test/dog.jpg', undefined],
        ]);
    });

    it('folds thumbnails that share a full-size original', () => {
        const full = { src: 'https://x.test/full/1.jpg', width: 3000, height: 2000, type: 'image/jpeg', via: 'link' };
        const kept = foldDuplicates([image('https://x.test/t1.jpg', 100, 100, 0, { full }), image('https://x.test/t2.jpg', 200, 200, 1, { full })]);
        expect(kept).toHaveLength(1);
    });
});

describe('conversion decisions', () => {
    it('fits the longest side, never enlarging', () => {
        expect(fitWithin(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
        expect(fitWithin(600, 1200, 1024)).toEqual({ width: 512, height: 1024 });
        expect(fitWithin(800, 600, 1024)).toEqual({ width: 800, height: 600 });
        expect(fitWithin(800, 600, 0)).toEqual({ width: 800, height: 600 });
    });

    it('tells animated GIF and WebP from still ones, and does nothing when nothing is asked', () => {
        const frame = [0x21, 0xf9, 0x04, 0, 10, 0, 0, 0x00, 0x2c, 0, 0, 0, 0];
        const gif = (frames: number) => new Uint8Array([...'GIF89a'].map(c => c.charCodeAt(0)).concat(...Array(frames).fill(frame)));
        expect(isAnimated(gif(3), 'image/gif')).toBe(true);
        expect(isAnimated(gif(1), 'image/gif')).toBe(false);
        const webp = (flags: number) => new Uint8Array([...'RIFF\0\0\0\0WEBPVP8X'].map(c => c.charCodeAt(0)).concat([10, 0, 0, 0, flags, 0, 0, 0]));
        expect(isAnimated(webp(0x02), 'image/webp')).toBe(true);
        expect(isAnimated(webp(0x10), 'image/webp')).toBe(false);
        expect(asksForWork(NO_PROCESSING)).toBe(false);
        expect(asksForWork({ ...NO_PROCESSING, maxSide: 1024 })).toBe(true);
    });
});
