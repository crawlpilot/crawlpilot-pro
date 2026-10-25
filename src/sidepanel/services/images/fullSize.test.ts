import { describe, it, expect } from 'vitest';
import { imageDimensions } from '../../../shared/images/dimensions';
import { fullSizeCandidates } from '../../../shared/images/fullsize';
import type { FoundImage } from '../../../shared/images/types';
import { findFullSize } from './fullSize';
import { probeImage, type Probe } from './probe';
import { saveImages } from './save';
import { FetchFailure } from './fetchImage';

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap(p => typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

const image = (src: string, extra: Partial<FoundImage> = {}): FoundImage =>
    ({ src, variants: [], width: 0, height: 0, type: '', origin: 'img', hidden: false, order: 0, pageUrl: 'https://shop.test/p', ...extra });

describe('imageDimensions', () => {
    it('reads the size from the first bytes of each format', () => {
        expect(imageDimensions(bytes([0x89], 'PNG', [13, 10, 26, 10], be32(13), 'IHDR', be32(1920), be32(1080)))).toEqual({ width: 1920, height: 1080 });
        expect(imageDimensions(bytes('GIF89a', le16(640), le16(480)))).toEqual({ width: 640, height: 480 });
        // JPEG: an APP1 (EXIF) segment before the frame header.
        expect(imageDimensions(bytes([0xff, 0xd8, 0xff, 0xe1], be16(8), 'Exif', [0, 0], [0xff, 0xc0], be16(17), [8], be16(3000), be16(4000), [3]))).toEqual({ width: 4000, height: 3000 });
        expect(imageDimensions(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8X', [10, 0, 0, 0], [0, 0, 0, 0], le24(2047), le24(1023)))).toEqual({ width: 2048, height: 1024 });
        expect(imageDimensions(bytes([0, 0, 0, 0x1c], 'ftypavif', [0, 0, 0, 0], 'meta....', [0, 0, 0, 20], 'ispe', [0, 0, 0, 0], be32(1200), be32(800)))).toEqual({ width: 1200, height: 800 });
        expect(imageDimensions(bytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150">'))).toEqual({ width: 300, height: 150 });
        expect(imageDimensions(bytes('<html>'))).toBeNull();
    });
});

describe('CDN rules', () => {
    const first = (src: string) => fullSizeCandidates(src)[0];
    it.each([
        ['shopify', 'https://cdn.shopify.com/s/files/1/0/products/lamp_300x300@2x.jpg?v=12', 'https://cdn.shopify.com/s/files/1/0/products/lamp.jpg?v=12'],
        ['wordpress', 'https://blog.test/wp-content/uploads/2024/05/photo-300x200.jpg', 'https://blog.test/wp-content/uploads/2024/05/photo.jpg'],
        ['wordpress', 'https://i0.wp.com/blog.test/photo.jpg?resize=300%2C200&ssl=1', 'https://i0.wp.com/blog.test/photo.jpg'],
        ['cloudinary', 'https://res.cloudinary.com/acme/image/upload/w_300,h_200,c_fill/q_auto/v1712/shoes/red.jpg', 'https://res.cloudinary.com/acme/image/upload/v1712/shoes/red.jpg'],
        ['amazon', 'https://m.media-amazon.com/images/I/71abcDEF+L._AC_SX300_SY300_QL70_.jpg', 'https://m.media-amazon.com/images/I/71abcDEF+L.jpg'],
        ['wix', 'https://static.wixstatic.com/media/abc_123~mv2.jpg/v1/fill/w_300,h_200,al_c/abc.jpg', 'https://static.wixstatic.com/media/abc_123~mv2.jpg'],
        ['squarespace', 'https://images.squarespace-cdn.com/content/v1/x/photo.jpg?format=300w', 'https://images.squarespace-cdn.com/content/v1/x/photo.jpg?format=2500w'],
        ['pinterest', 'https://i.pinimg.com/236x/ab/cd/ef/abcdef.jpg', 'https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg'],
        ['twitter', 'https://pbs.twimg.com/media/Fabc123?format=jpg&name=small', 'https://pbs.twimg.com/media/Fabc123?format=jpg&name=orig'],
        ['etsy', 'https://i.etsystatic.com/123/r/il/abc/456/il_340x270.456_xyz.jpg', 'https://i.etsystatic.com/123/r/il/abc/456/il_fullxfull.456_xyz.jpg'],
        ['ebay', 'https://i.ebayimg.com/images/g/abc/s-l300.jpg', 'https://i.ebayimg.com/images/g/abc/s-l1600.jpg'],
        ['google', 'https://lh3.googleusercontent.com/abc123=w400-h300-c', 'https://lh3.googleusercontent.com/abc123=s0'],
        ['youtube', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'],
        ['generic', 'https://images.ctfassets.net/sp/abc/photo.jpg?w=300&h=200&fit=fill', 'https://images.ctfassets.net/sp/abc/photo.jpg'],
        ['generic', 'https://i5.walmartimages.com/asr/abc.jpeg?odnHeight=180&odnWidth=180&odnBg=FFFFFF', 'https://i5.walmartimages.com/asr/abc.jpeg'],
    ])('%s: %s', (rule, src, expected) => {
        expect(first(src)).toEqual({ url: expected, rule });
    });

    it('offers nothing for a URL with no size in it, or an inline image', () => {
        expect(fullSizeCandidates('https://shop.test/images/lamp.jpg')).toEqual([]);
        expect(fullSizeCandidates('data:image/png;base64,AAAA')).toEqual([]);
    });
});

describe('findFullSize', () => {
    const probes = (sizes: Record<string, [number, number] | null>) => async (url: string): Promise<Probe | null> => {
        const s = sizes[url];
        return s ? { url, type: 'image/jpeg', width: s[0], height: s[1] } : null;
    };

    it('takes the largest real candidate: the linked original, else a CDN rewrite', async () => {
        const thumb = image('https://blog.test/wp-content/uploads/a-300x200.jpg', { width: 300, height: 200, linked: 'https://blog.test/full/a.jpg' });
        const full = await findFullSize(thumb, probes({ 'https://blog.test/full/a.jpg': [3000, 2000], 'https://blog.test/wp-content/uploads/a.jpg': [1200, 800] }));
        expect(full).toMatchObject({ src: 'https://blog.test/full/a.jpg', width: 3000, via: 'link' });
        const noLink = await findFullSize({ ...thumb, linked: undefined }, probes({ 'https://blog.test/wp-content/uploads/a.jpg': [1200, 800] }));
        expect(noLink).toMatchObject({ src: 'https://blog.test/wp-content/uploads/a.jpg', via: 'wordpress' });
    });

    it('keeps the image when no candidate is real or clearly larger; probes the image when its size is unknown', async () => {
        const img = image('https://blog.test/wp-content/uploads/b-300x200.jpg', { width: 300, height: 200 });
        expect(await findFullSize(img, probes({}))).toBeNull();
        expect(await findFullSize({ ...img, width: 1180, height: 790 }, probes({ 'https://blog.test/wp-content/uploads/b.jpg': [1200, 800] }))).toBeNull();
        const unknown = image('https://blog.test/wp-content/uploads/c-300x200.jpg');
        expect(await findFullSize(unknown, probes({ [unknown.src]: [300, 200], 'https://blog.test/wp-content/uploads/c.jpg': [2400, 1600] }))).toMatchObject({ width: 2400 });
    });
});

describe('probeImage', () => {
    it('reads only the first bytes even when the server ignores Range, and reads the total size', async () => {
        const png = bytes([0x89], 'PNG', [13, 10, 26, 10], be32(13), 'IHDR', be32(5000), be32(4000));
        let pulled = 0;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulled++;
                controller.enqueue(pulled === 1 ? png : new Uint8Array(64 * 1024));
                if (pulled > 1000) controller.close();
            },
        });
        const fetchFn = (async () => new Response(body, { status: 200, headers: { 'content-length': String(60_000_000) } })) as unknown as typeof fetch;
        const p = await probeImage('https://x.test/huge.png', new AbortController().signal, fetchFn);
        expect(p).toMatchObject({ type: 'image/png', width: 5000, height: 4000, bytes: 60_000_000 });
        expect(pulled).toBeLessThan(10);
    });
});

describe('saving originals', () => {
    it('saves the original, named after it; falls back to the shown file when the original is refused', async () => {
        const PNG = bytes([0x89], 'PNG', [13, 10, 26, 10]);
        const names: string[] = [];
        const images = [
            image('https://cdn.test/a-300x200.png', { full: { src: 'https://cdn.test/a.png', width: 3000, height: 2000, type: 'image/png', via: 'generic' } }),
            image('https://cdn.test/b-300x200.png', { full: { src: 'https://cdn.test/locked/b.png', width: 3000, height: 2000, type: 'image/png', via: 'generic' } }),
        ];
        const report = await saveImages(images, { mode: 'folder', template: '{name}-{width}', pageTitle: '', signal: new AbortController().signal }, {
            fetch: async url => { if (url.includes('locked')) throw new FetchFailure('blocked', 403); return { bytes: PNG, type: 'image/png', via: 'direct' }; },
            download: async (_blob, filename) => { names.push(filename); },
        });
        expect(names.sort()).toEqual(['CrawlPilot/shop.test/a-3000.png', 'CrawlPilot/shop.test/b-300x200.png']);
        expect(report).toMatchObject({ done: 2, failed: 0, downgraded: 1 });
    });
});
