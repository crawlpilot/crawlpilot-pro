import type { ImageMeta } from '../../../content/features/universal-images/ImageScanner';

export function getExtension(src: string): string {
    try {
        const ext = new URL(src).pathname.split('.').pop()?.toLowerCase();
        return ext && ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'avif'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg';
    } catch {
        return 'jpg';
    }
}

function sizeCategory(width: number, height: number): string {
    const pixels = width * height;
    if (pixels < 500 * 500) return 'small';
    if (pixels < 1920 * 1080) return 'medium';
    return 'large';
}

export interface ImageFilters {
    onlyVisible: boolean;
    searchQuery: string;
    minWidth: number | '';
    maxWidth: number | '';
    minHeight: number | '';
    maxHeight: number | '';
    fileTypes: Set<string>;
    sizeCategories: Set<string>;
}

export function filterImages(images: ImageMeta[], f: ImageFilters): ImageMeta[] {
    const q = f.searchQuery.toLowerCase();
    return images.filter(img => {
        if (f.onlyVisible && img.isVisible === false) return false;
        if (q && !img.src.toLowerCase().includes(q) && !(img.alt && img.alt.toLowerCase().includes(q))) return false;
        if (f.minWidth !== '' && img.naturalWidth < f.minWidth) return false;
        if (f.maxWidth !== '' && img.naturalWidth > f.maxWidth) return false;
        if (f.minHeight !== '' && img.naturalHeight < f.minHeight) return false;
        if (f.maxHeight !== '' && img.naturalHeight > f.maxHeight) return false;
        return f.fileTypes.has(getExtension(img.src)) && f.sizeCategories.has(sizeCategory(img.naturalWidth, img.naturalHeight));
    });
}

export interface SizeGroup {
    label: string;
    width: number;
    height: number;
    images: ImageMeta[];
}

/** Images grouped by size (within 20% in both dimensions), largest group first. */
export function buildSizeGroups(images: ImageMeta[]): SizeGroup[] {
    const groups: SizeGroup[] = [];
    for (const img of images) {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w === 0 && h === 0) continue;
        const group = groups.find(g => Math.abs(g.width - w) / Math.max(g.width, 1) <= 0.2 && Math.abs(g.height - h) / Math.max(g.height, 1) <= 0.2);
        if (group) group.images.push(img);
        else groups.push({ label: `${w}×${h}`, width: w, height: h, images: [img] });
    }
    return groups.sort((a, b) => b.images.length - a.images.length);
}
