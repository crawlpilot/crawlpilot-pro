import type { FoundImage } from '../../../shared/images/types';
import { guessType, typeLabel } from '../../../shared/images/type';

/** The short type of an image (`jpg`, `webp`, …), or '' when neither the URL nor a fetch has said. */
export function imageType(img: Pick<FoundImage, 'src' | 'type'>): string {
    return typeLabel(img.type || guessType(img.src));
}

/** A file extension for saving it: its type, else `jpg`. */
export function getExtension(img: Pick<FoundImage, 'src' | 'type'>): string {
    return imageType(img) || 'jpg';
}

function sizeCategory(width: number, height: number): string {
    const pixels = width * height;
    if (pixels < 500 * 500) return 'small';
    if (pixels < 1920 * 1080) return 'medium';
    return 'large';
}

/** Below this in both directions, a measured image is a tracking pixel or a spacer: never listed. */
const TINY = 10;

export interface ImageFilters {
    includeHidden: boolean;
    searchQuery: string;
    minWidth: number | '';
    maxWidth: number | '';
    minHeight: number | '';
    maxHeight: number | '';
    fileTypes: Set<string>;
    sizeCategories: Set<string>;
}

/**
 * Images passing the filters. Unknown values pass: an image whose size isn't measured yet passes the
 * size filters, one whose type isn't known passes the type filter.
 */
export function filterImages(images: FoundImage[], f: ImageFilters): FoundImage[] {
    const q = f.searchQuery.toLowerCase();
    return images.filter(img => {
        const { width: w, height: h } = img;
        const sized = w > 0 && h > 0;
        if (sized && w < TINY && h < TINY) return false;
        if (!f.includeHidden && img.hidden) return false;
        if (q && ![img.src, img.alt, img.title, img.caption, img.heading].some(t => t?.toLowerCase().includes(q))) return false;
        if (sized) {
            if (f.minWidth !== '' && w < f.minWidth) return false;
            if (f.maxWidth !== '' && w > f.maxWidth) return false;
            if (f.minHeight !== '' && h < f.minHeight) return false;
            if (f.maxHeight !== '' && h > f.maxHeight) return false;
            if (!f.sizeCategories.has(sizeCategory(w, h))) return false;
        }
        const type = imageType(img);
        return !type || f.fileTypes.has(type);
    });
}

export interface SizeGroup {
    label: string;
    width: number;
    height: number;
    images: FoundImage[];
}

/** Images grouped by size (within 20% in both dimensions), largest group first. */
export function buildSizeGroups(images: FoundImage[]): SizeGroup[] {
    const groups: SizeGroup[] = [];
    for (const img of images) {
        const w = img.width;
        const h = img.height;
        if (w === 0 && h === 0) continue;
        const group = groups.find(g => Math.abs(g.width - w) / Math.max(g.width, 1) <= 0.2 && Math.abs(g.height - h) / Math.max(g.height, 1) <= 0.2);
        if (group) group.images.push(img);
        else groups.push({ label: `${w}×${h}`, width: w, height: h, images: [img] });
    }
    return groups.sort((a, b) => b.images.length - a.images.length);
}
