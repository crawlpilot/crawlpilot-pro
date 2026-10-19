import { describe, it, expect } from 'vitest';
import { buildSizeGroups, DEFAULT_FILTERS, filterImages, getExtension, groupImages, imageType, matcher, sortImages, type ImageFilters } from './imageFilters';
import type { FoundImage } from '../../../shared/images/types';

const img = (src: string, width: number, height: number, extra: Partial<FoundImage> = {}) =>
    ({ src, width, height, type: '', variants: [], origin: 'img', hidden: false, order: 0, pageUrl: '', ...extra }) as FoundImage;

const ALL: ImageFilters = { ...DEFAULT_FILTERS, hideIcons: false };

describe('image filters', () => {
    it('types an image from its fetched type, else its URL; unknown is empty', () => {
        expect(imageType(img('https://a.test/x/photo.JPEG?w=200', 0, 0))).toBe('jpg');
        expect(imageType(img('https://a.test/x/photo', 0, 0, { type: 'image/webp' }))).toBe('webp');
        expect(imageType(img('https://a.test/x/photo', 0, 0))).toBe('');
        expect(getExtension(img('https://a.test/x/photo', 0, 0))).toBe('jpg');
    });

    it('filters by size, type, search and hidden; unknown size and type pass', () => {
        const images = [
            img('https://a.test/hero.png', 1600, 900, { alt: 'Hero shot' }),
            img('https://a.test/icon.svg', 16, 16),
            img('https://a.test/pixel.gif', 1, 1),
            img('https://a.test/slide.png', 800, 600, { hidden: true }),
            img('https://a.test/lazy?id=1', 0, 0),
        ];
        const src = (f: Partial<ImageFilters>) => filterImages(images, { ...ALL, ...f }).map(i => i.src.replace('https://a.test/', ''));
        expect(src({})).toEqual(['hero.png', 'icon.svg', 'slide.png', 'lazy?id=1']);
        expect(src({ minWidth: 100 })).toEqual(['hero.png', 'slide.png', 'lazy?id=1']);
        expect(src({ includeHidden: false, fileTypes: new Set(['png']) })).toEqual(['hero.png', 'lazy?id=1']);
        expect(src({ searchQuery: 'hero' })).toEqual(['hero.png']);
    });

    it('groups images of about the same size, biggest group first', () => {
        const groups = buildSizeGroups([img('a', 300, 300), img('b', 1200, 800), img('c', 310, 290), img('d', 320, 300)]);
        expect(groups.map(g => [g.label, g.images.length])).toEqual([['300×300', 3], ['1200×800', 1]]);
    });

    it('hides icons, matches URL patterns (text or /regex/), keeps chosen hosts and shapes', () => {
        const images = [
            img('https://cdn.a.test/products/1.jpg', 1200, 1200),
            img('https://cdn.a.test/banners/top.jpg', 1600, 400),
            img('https://ads.b.test/promo.png', 300, 600),
            img('https://a.test/favicon.png', 32, 32, { origin: 'icon' }),
        ];
        const src = (f: Partial<ImageFilters>) => filterImages(images, { ...ALL, ...f }).map(i => i.src.split('/').pop());
        expect(src({ hideIcons: true })).toEqual(['1.jpg', 'top.jpg', 'promo.png']);
        expect(src({ include: '/products|banners/' })).toEqual(['1.jpg', 'top.jpg']);
        expect(src({ exclude: 'ads.' })).toEqual(['1.jpg', 'top.jpg', 'favicon.png']);
        expect(src({ domains: new Set(['ads.b.test']) })).toEqual(['promo.png']);
        expect(src({ aspects: new Set(['banner', 'portrait']) })).toEqual(['top.jpg', 'promo.png']);
        expect(matcher('/[unclosed/')!('https://x.test/[unclosed/a.jpg')).toBe(true); // invalid regex: plain text
    });

    it('sorts and groups by section and host', () => {
        const images = [img('https://x.test/a.jpg', 100, 100, { order: 0, heading: 'Shoes' }), img('https://y.test/b.png', 900, 900, { order: 1, heading: 'Bags' }), img('https://x.test/c.gif', 400, 400, { order: 2, heading: 'Shoes' })];
        expect(sortImages(images, 'largest').map(i => i.width)).toEqual([900, 400, 100]);
        expect(sortImages(images, 'type').map(i => i.src.slice(-3))).toEqual(['gif', 'jpg', 'png']);
        expect(groupImages(images, 'section').map(g => [g.label, g.images.length])).toEqual([['Shoes', 2], ['Bags', 1]]);
        expect(groupImages(images, 'domain').map(g => [g.label, g.images.length])).toEqual([['x.test', 2], ['y.test', 1]]);
    });
});
