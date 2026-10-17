import { describe, it, expect } from 'vitest';
import { buildSizeGroups, filterImages, getExtension } from './imageFilters';

const img = (src: string, w: number, h: number, extra: object = {}) => ({ src, naturalWidth: w, naturalHeight: h, ...extra }) as any;

describe('image filters', () => {
    it('reads the extension from the URL path', () => {
        expect(getExtension('https://a.test/x/photo.JPEG?w=200')).toBe('jpg');
        expect(getExtension('https://a.test/x/photo.webp')).toBe('webp');
        expect(getExtension('https://a.test/x/photo')).toBe('jpg');
    });

    it('filters by visibility, search, size and type', () => {
        const images = [img('https://a.test/hero.png', 1600, 900), img('https://a.test/icon.svg', 16, 16), img('https://a.test/hidden.png', 800, 600, { isVisible: false })];
        const out = filterImages(images, {
            onlyVisible: true, searchQuery: '', minWidth: 100, maxWidth: '', minHeight: '', maxHeight: '',
            fileTypes: new Set(['png', 'svg']), sizeCategories: new Set(['small', 'medium', 'large']),
        });
        expect(out.map(i => i.src)).toEqual(['https://a.test/hero.png']);
    });

    it('groups images of about the same size, biggest group first', () => {
        const groups = buildSizeGroups([img('a', 300, 300), img('b', 1200, 800), img('c', 310, 290), img('d', 320, 300)]);
        expect(groups.map(g => [g.label, g.images.length])).toEqual([['300×300', 3], ['1200×800', 1]]);
    });
});
