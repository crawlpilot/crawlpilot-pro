import { describe, it, expect } from 'vitest';
import { buildSizeGroups, filterImages, getExtension, imageType, type ImageFilters } from './imageFilters';
import type { FoundImage } from '../../../shared/images/types';

const img = (src: string, width: number, height: number, extra: Partial<FoundImage> = {}) =>
    ({ src, width, height, type: '', variants: [], origin: 'img', hidden: false, order: 0, pageUrl: '', ...extra }) as FoundImage;

const ALL: ImageFilters = {
    includeHidden: true, searchQuery: '', minWidth: '', maxWidth: '', minHeight: '', maxHeight: '',
    fileTypes: new Set(['jpg', 'png', 'svg', 'webp']), sizeCategories: new Set(['small', 'medium', 'large']),
};

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
});
