import type { FoundImage } from '../../../shared/images/types';
import { guessType, typeLabel } from '../../../shared/images/type';

/** The short type of an image (`jpg`, `webp`, …), or '' when neither the URL nor a fetch has said. */
export function imageType(img: Pick<FoundImage, 'src' | 'type' | 'full'>): string {
    return typeLabel(img.full?.type || img.type || guessType(img.src));
}

/** The size that will be saved: the full-size original's when one was found. */
export function savedSize(img: Pick<FoundImage, 'width' | 'height' | 'full'>): { width: number; height: number } {
    return img.full ?? img;
}

/** The URL that will be saved. */
export function savedSrc(img: Pick<FoundImage, 'src' | 'full'>): string {
    return img.full?.src ?? img.src;
}

/** A file extension for saving it: its type, else `jpg`. */
export function getExtension(img: Pick<FoundImage, 'src' | 'type' | 'full'>): string {
    return imageType(img) || 'jpg';
}

/** The host an image is served from (`inline` for data: and blob: images). */
export function imageDomain(img: Pick<FoundImage, 'src'>): string {
    if (img.src.startsWith('data:') || img.src.startsWith('blob:')) return 'inline';
    try { return new URL(img.src).hostname.replace(/^www\./, ''); } catch { return 'inline'; }
}

function sizeCategory(width: number, height: number): string {
    const pixels = width * height;
    if (pixels < 500 * 500) return 'small';
    if (pixels < 1920 * 1080) return 'medium';
    return 'large';
}

export type Aspect = 'square' | 'portrait' | 'landscape' | 'banner';

export function aspectOf(width: number, height: number): Aspect {
    const ratio = width / height;
    if (ratio >= 0.9 && ratio <= 1.1) return 'square';
    if (ratio < 0.9) return 'portrait';
    return ratio > 2 ? 'banner' : 'landscape';
}

/** Below this in both directions, a measured image is a tracking pixel or a spacer: never listed. */
const TINY = 10;
/** Icons: favicons, and anything this small in both directions. */
const ICON = 64;

export function isIconLike(img: FoundImage): boolean {
    if (img.origin === 'icon') return true;
    const { width, height } = savedSize(img);
    return width > 0 && height > 0 && width <= ICON && height <= ICON;
}

/** A pattern typed by the user: `/regex/i` or plain text (case-insensitive). An invalid regex is plain text. */
export function matcher(pattern: string): ((text: string) => boolean) | null {
    const p = pattern.trim();
    if (!p) return null;
    const re = /^\/(.+)\/([gimsuy]*)$/.exec(p);
    if (re) {
        try { const regex = new RegExp(re[1], re[2].replace('g', '') || 'i'); return text => regex.test(text); } catch { /* plain text */ }
    }
    const lower = p.toLowerCase();
    return text => text.toLowerCase().includes(lower);
}

export interface ImageFilters {
    includeHidden: boolean;
    hideIcons: boolean;
    searchQuery: string;
    /** URLs to keep / drop: text or `/regex/`. */
    include: string;
    exclude: string;
    minWidth: number | '';
    maxWidth: number | '';
    minHeight: number | '';
    maxHeight: number | '';
    fileTypes: Set<string>;
    sizeCategories: Set<string>;
    aspects: Set<Aspect>;
    /** Hosts to keep; empty keeps every host. */
    domains: Set<string>;
}

export const DEFAULT_FILTERS: ImageFilters = {
    includeHidden: true,
    hideIcons: true,
    searchQuery: '',
    include: '',
    exclude: '',
    minWidth: '',
    maxWidth: '',
    minHeight: '',
    maxHeight: '',
    fileTypes: new Set(['jpg', 'png', 'webp', 'gif', 'svg', 'avif']),
    sizeCategories: new Set(['small', 'medium', 'large']),
    aspects: new Set<Aspect>(['square', 'portrait', 'landscape', 'banner']),
    domains: new Set(),
};

/**
 * Images passing the filters. Unknown values pass: an image whose size isn't measured yet passes the
 * size and shape filters, one whose type isn't known passes the type filter.
 */
export function filterImages(images: FoundImage[], f: ImageFilters): FoundImage[] {
    const q = f.searchQuery.toLowerCase();
    const include = matcher(f.include);
    const exclude = matcher(f.exclude);
    return images.filter(img => {
        const { width: w, height: h } = savedSize(img);
        const sized = w > 0 && h > 0;
        if (sized && w < TINY && h < TINY) return false;
        if (!f.includeHidden && img.hidden) return false;
        if (f.hideIcons && isIconLike(img)) return false;
        if (q && ![img.src, img.alt, img.title, img.caption, img.heading].some(t => t?.toLowerCase().includes(q))) return false;
        const urls = `${img.src} ${img.full?.src ?? ''}`;
        if (include && !include(urls)) return false;
        if (exclude && exclude(urls)) return false;
        if (f.domains.size && !f.domains.has(imageDomain(img))) return false;
        if (sized) {
            if (f.minWidth !== '' && w < f.minWidth) return false;
            if (f.maxWidth !== '' && w > f.maxWidth) return false;
            if (f.minHeight !== '' && h < f.minHeight) return false;
            if (f.maxHeight !== '' && h > f.maxHeight) return false;
            if (!f.sizeCategories.has(sizeCategory(w, h))) return false;
            if (!f.aspects.has(aspectOf(w, h))) return false;
        }
        const type = imageType(img);
        return !type || f.fileTypes.has(type);
    });
}

export type SortBy = 'page' | 'largest' | 'smallest' | 'type';

export function sortImages(images: FoundImage[], by: SortBy): FoundImage[] {
    const pixels = (i: FoundImage) => { const s = savedSize(i); return s.width * s.height; };
    const list = [...images];
    switch (by) {
        case 'largest': return list.sort((a, b) => pixels(b) - pixels(a) || a.order - b.order);
        case 'smallest': return list.sort((a, b) => (pixels(a) || Infinity) - (pixels(b) || Infinity) || a.order - b.order);
        case 'type': return list.sort((a, b) => imageType(a).localeCompare(imageType(b)) || a.order - b.order);
        default: return list.sort((a, b) => a.order - b.order);
    }
}

export interface ImageGroup {
    label: string;
    images: FoundImage[];
}

export type GroupBy = 'size' | 'section' | 'domain';

/** Images grouped by size (within 20% in both dimensions), by the heading above them, or by host; largest group first. */
export function groupImages(images: FoundImage[], by: GroupBy): ImageGroup[] {
    if (by === 'size') return buildSizeGroups(images);
    const groups = new Map<string, FoundImage[]>();
    for (const img of images) {
        const key = by === 'section' ? (img.heading || '—') : imageDomain(img);
        groups.set(key, [...(groups.get(key) ?? []), img]);
    }
    const list = [...groups].map(([label, imgs]) => ({ label, images: imgs }));
    // Sections keep page order; hosts go biggest first.
    return by === 'section' ? list : list.sort((a, b) => b.images.length - a.images.length);
}

export interface SizeGroup extends ImageGroup {
    width: number;
    height: number;
}

export function buildSizeGroups(images: FoundImage[]): SizeGroup[] {
    const groups: SizeGroup[] = [];
    for (const img of images) {
        const { width: w, height: h } = savedSize(img);
        if (w === 0 && h === 0) continue;
        const group = groups.find(g => Math.abs(g.width - w) / Math.max(g.width, 1) <= 0.2 && Math.abs(g.height - h) / Math.max(g.height, 1) <= 0.2);
        if (group) group.images.push(img);
        else groups.push({ label: `${w}×${h}`, width: w, height: h, images: [img] });
    }
    return groups.sort((a, b) => b.images.length - a.images.length);
}

/** Hosts in the scan, most images first. */
export function domainCounts(images: FoundImage[]): [string, number][] {
    const counts = new Map<string, number>();
    for (const img of images) counts.set(imageDomain(img), (counts.get(imageDomain(img)) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
}
